import { getSession, currentUserHasPermission } from 'kempo/server/sdk.js';

/*
  The same shape kempo-payments, kempo-thumbs and kempo-user-dirs use, for the same reason: a
  permission check written out longhand in every route is one that eventually has a clause wrong
  somewhere.

  Every route in this extension is gated, and there is no public one. A calculation costs an API
  call to Stripe, and an open endpoint would let anybody on the internet spend them. Whatever
  serves a customer — a checkout — calls the SDK from the server, where the decision to ask has
  already been made.
*/

export const requireSession = async request => {
  const token = request.cookies?.session_token;
  if(!token) return [{ code: 401, msg: 'Authentication required' }, null];

  const [error, session] = await getSession({ token });
  if(error || !session?.user) return [{ code: 401, msg: 'Authentication required' }, null];

  return [null, { token, user: session.user }];
};

export const requirePermission = async (token, name) => {
  const [error, allowed] = await currentUserHasPermission(token, name);
  if(error) return [{ code: error.code, msg: error.msg }, null];
  if(!allowed) return [{ code: 403, msg: 'Insufficient permissions' }, null];
  return [null, true];
};

export const gate = async (request, permission) => {
  const [sessionError, session] = await requireSession(request);
  if(sessionError) return [sessionError, null];

  const [permError] = await requirePermission(session.token, permission);
  if(permError) return [permError, null];

  return [null, session];
};
