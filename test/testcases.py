import asyncio
import json
import websockets
import time
from datetime import datetime

# Configuration
WS_URL = "wss://websockets-volleyball-stats.zellen.workers.dev/ws"  # Use wss for secure connection
DEBUG = True  # Set to True to enable debug prints

async def send_message(ws, resource, action, data):
    payload = {resource: {action: data}}
    message = json.dumps(payload)
    if DEBUG:
        print(f"Sending: {message}")
    await ws.send(message)

async def receive_message(ws):
    while True:
        response = await ws.recv()
        if DEBUG:
            print(f"Received: {response}")
        if response.startswith("Debug:"):
            print(f"Debug message: {response}")
            continue
        try:
            return json.loads(response)
        except json.JSONDecodeError:
            print(f"Non-JSON response: {response}")
            continue

async def client_behavior(client_id, queue_to_other, is_listener=False):
    async with websockets.connect(WS_URL) as ws:
        if DEBUG:
            print(f"Client {client_id} connected")
        
        # Wait for first debug message
        try:
            debug_msg = await asyncio.wait_for(ws.recv(), timeout=5)
            if DEBUG:
                print(f"Client {client_id} received debug: {debug_msg}")
        except asyncio.TimeoutError:
            pass
        
        # Wait for second debug message
        try:
            debug_msg2 = await asyncio.wait_for(ws.recv(), timeout=5)
            if DEBUG:
                print(f"Client {client_id} received debug2: {debug_msg2}")
        except asyncio.TimeoutError:
            pass
        
        if is_listener:
            try:
                while True:
                    msg = await ws.recv()
                    print(f"Listener {client_id} received broadcast: {msg}")
            except websockets.exceptions.ConnectionClosed:
                pass
        else:
            unique_suffix = str(int(time.time() % 10000))
            # Create players used in roster operations
            await send_message(ws, "player", "create", {"number": f"9{unique_suffix}", "last_name": "Starter", "initial": "S"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            starter_player_id = resp["body"]["id"]
            
            await send_message(ws, "player", "create", {"number": f"8{unique_suffix}", "last_name": "Bench", "initial": "B"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            bench_player_id = resp["body"]["id"]
            
            # Test match create
            await send_message(ws, "match", "create", {"date": datetime.now().isoformat(), "opponent": "Test Opponent " + unique_suffix})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            match_id = resp["body"]["id"]
            if DEBUG:
                print(f"Client {client_id} created match {match_id}")
            
            await asyncio.sleep(1)  # Allow time for broadcast
            
            # Test set-location
            await send_message(ws, "match", "set-location", {"matchId": match_id, "location": "Test Location"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-date-time
            new_date = datetime.now().isoformat()
            await send_message(ws, "match", "set-date-time", {"matchId": match_id, "date": new_date})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-opp-name
            await send_message(ws, "match", "set-opp-name", {"matchId": match_id, "opponent": "New Opponent"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-type
            await send_message(ws, "match", "set-type", {"matchId": match_id, "types": '{"tournament": true}'})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-result
            await send_message(ws, "match", "set-result", {"matchId": match_id, "resultHome": 3, "resultOpp": 2})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-players
            await send_message(ws, "match", "set-players", {"matchId": match_id, "players": json.dumps([{"player_id": starter_player_id, "temp_number": 11}])})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-home-color
            await send_message(ws, "match", "set-home-color", {"matchId": match_id, "jerseyColorHome": "blue"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-opp-color
            await send_message(ws, "match", "set-opp-color", {"matchId": match_id, "jerseyColorOpp": "red"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-first-server
            await send_message(ws, "match", "set-first-server", {"matchId": match_id, "firstServer": "home"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test add-player
            await send_message(ws, "match", "add-player", {"matchId": match_id, "player": json.dumps({"player_id": bench_player_id, "temp_number": 22})})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test update-player
            await send_message(ws, "match", "update-player", {"matchId": match_id, "player": json.dumps({"player_id": bench_player_id, "temp_number": 33})})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test remove-player
            await send_message(ws, "match", "remove-player", {"matchId": match_id, "player": json.dumps({"player_id": starter_player_id, "temp_number": 11})})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-deleted
            await send_message(ws, "match", "set-deleted", {"matchId": match_id, "deleted": True})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test match get single
            await send_message(ws, "match", "get", {"matchId": match_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            # Test match get all
            await send_message(ws, "match", "get", {})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            # Test match delete
            await send_message(ws, "match", "delete", {"id": match_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Now player tests
            player_number = str(client_id) + unique_suffix
            await send_message(ws, "player", "create", {"number": player_number, "last_name": "Test", "initial": "T"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            player_id = resp["body"]["id"]
            
            await asyncio.sleep(1)
            
            # Test set-lname
            await send_message(ws, "player", "set-lname", {"playerId": player_id, "lastName": "NewTest"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-fname
            await send_message(ws, "player", "set-fname", {"playerId": player_id, "initial": "N"})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-number
            await send_message(ws, "player", "set-number", {"playerId": player_id, "number": "20" + unique_suffix})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test player get single
            await send_message(ws, "player", "get", {"id": player_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            # Test player get all
            await send_message(ws, "player", "get", {})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            # Test player delete
            await send_message(ws, "player", "delete", {"id": player_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Clean up roster players
            await send_message(ws, "player", "delete", {"id": bench_player_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            await send_message(ws, "player", "delete", {"id": starter_player_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Create a match for set tests
            await send_message(ws, "match", "create", {"date": datetime.now().isoformat(), "opponent": "Set Test " + unique_suffix})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            set_match_id = resp["body"]["id"]
            
            await asyncio.sleep(1)
            
            # Get sets for match
            await send_message(ws, "set", "get", {"matchId": set_match_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            sets = resp["body"]
            set_id = None
            for s in sets:
                set_number = s.get("number") or s.get("set_number") or s.get("setNumber")
                if set_number == 1:
                    set_id = s.get("id") or s.get("set_id") or s.get("setId")
                    break
            
            if set_id is None:
                # Test set create
                await send_message(ws, "set", "create", {"matchId": set_match_id, "setNumber": 1})
                resp = await receive_message(ws)
                assert resp["status"] < 300
                set_id = resp["body"]["id"]
            
            await asyncio.sleep(1)
            
            # Test set-home-score
            await send_message(ws, "set", "set-home-score", {"setId": set_id, "homeScore": 25})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-opp-score
            await send_message(ws, "set", "set-opp-score", {"setId": set_id, "oppScore": 20})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-home-timeout
            await send_message(ws, "set", "set-home-timeout", {"setId": set_id, "timeoutNumber": 1, "value": True})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-opp-timeout
            await send_message(ws, "set", "set-opp-timeout", {"setId": set_id, "timeoutNumber": 2, "value": True})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set-is-final
            await send_message(ws, "set", "set-is-final", {"matchId": set_match_id, "finalizedSets": '{"1": true}'})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Test set get single
            await send_message(ws, "set", "get", {"id": set_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            # Test set get all for match
            await send_message(ws, "set", "get", {"matchId": set_match_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            # Test set delete
            await send_message(ws, "set", "delete", {"id": set_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            # Clean up match
            await send_message(ws, "match", "delete", {"id": set_match_id})
            resp = await receive_message(ws)
            assert resp["status"] < 300
            
            await asyncio.sleep(1)
            
            if DEBUG:
                print(f"Client {client_id} finished")

async def run_test():
    queue1_to_2 = asyncio.Queue()
    queue2_to_1 = asyncio.Queue()
    
    # Run two clients concurrently
    task1 = asyncio.create_task(client_behavior(1, queue1_to_2, is_listener=False))
    task2 = asyncio.create_task(client_behavior(2, queue2_to_1, is_listener=True))
    
    await task1
    await asyncio.sleep(5)  # Allow listener to receive remaining messages
    task2.cancel()
    
    print("Test completed successfully")

# Run the test
asyncio.run(run_test())
