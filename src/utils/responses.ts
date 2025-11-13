// src/utils/responses.ts
export function jsonSuccess(data: any = {}, status: number = 200): Response {
  return new Response(JSON.stringify({ success: true, ...data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function textResponse(message: string, status: number = 200): Response {
  return new Response(message, { status });
}

export function errorResponse(message: string, status: number = 500): Response {
  return new Response(message, { status });
}

export function methodNotAllowed(allowedMethods = []) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: {
      Allow: allowedMethods.join(', ')
    }
  });
}

export function notFound(message = 'Not Found') {
  return Response.json({ error: message }, { status: 404 });
}
