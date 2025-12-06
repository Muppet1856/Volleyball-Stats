import { getAuthorizedUser } from "../auth-guard";
import { initMatchTable, initPlayerTable, initSetTable } from "../utils/init";
import { errorResponse } from "../utils/responses";
import { Env } from "../env";
import { createSubscriptionHelpers, SubscriptionHelpers } from "./subscriptions";
import { BroadcastContext } from "./broadcast";
import { handleWebSocketMessage } from "./websocket-message";

export class MatchState {
  state: DurableObjectState;
  env: Env;
  isDebug: boolean;
  // Track WebSocket clients that explicitly subscribe to match IDs.
  // Missing or empty subscription set means the client receives all broadcasts.
  private matchSubscriptions: Map<string, Set<number>> = new Map();
  private subscriptions: SubscriptionHelpers;
  private broadcastContext: BroadcastContext;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.isDebug = env.debug === "true";

    // Init all tables the first time the DO is created
    const sql = this.state.storage.sql;
    initMatchTable(sql);
    initPlayerTable(sql);
    initSetTable(sql);

    this.subscriptions = createSubscriptionHelpers({
      state: this.state,
      matchSubscriptions: this.matchSubscriptions,
      isDebug: this.isDebug,
    });

    this.broadcastContext = { state: this.state };

    this.subscriptions.restoreSubscriptionsFromAttachments();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle WebSocket upgrades for /ws inside the DO
    if (path.startsWith("/ws")) {
      // Authentication logic
      const user = await getAuthorizedUser(request, this.env);
      if (!user) {
        return new Response('Unauthorized', { status: 401 });
      }
      // Proceed with WebSocket upgrade
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

      // Generate unique client ID
      const clientId = Math.random().toString(36).slice(2);

      // Accept the WebSocket with clientId as tag
      this.state.acceptWebSocket(server, [clientId]);

      // Persist base attachment so subscriptions survive hibernation
      this.subscriptions.registerClient(clientId, server);

      // Send debug message if enabled (no initial data dump)
      if (this.isDebug) {
        const sql = this.state.storage.sql;
        const cursor = sql.exec('SELECT COUNT(*) FROM matches');
        const count = cursor.next().value['COUNT(*)'];
        server.send(JSON.stringify({ debug: `${count} matches in DB` }));
        server.send(JSON.stringify({ debug: `New client connected: ${clientId}` }));
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    return errorResponse("Method not allowed", 405);
  }

  // Handle WebSocket messages (dispatched by runtime after acceptWebSocket)
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    return handleWebSocketMessage(
      {
        state: this.state,
        subscriptions: this.subscriptions,
        broadcastContext: this.broadcastContext,
      },
      ws,
      message
    );
  }

  // Clean up closed connections
  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    this.subscriptions.dropClient(ws);
  }

  // Handle errors (optional, but cleans up)
  async webSocketError(_ws: WebSocket, _error: any) {
    // Currently intentionally a no-op; hooks are kept for parity with the Workers runtime.
  }
}
