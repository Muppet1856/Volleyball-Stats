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

export function unauthorized(message = 'Unauthorized') {
  return new Response(message, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Volleyball Stats API"'
    }
  });
}
