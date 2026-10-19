/** The SDK imports 'ws' only under Node; in the extension the browser's
 *  WebSocket is used and this is never constructed. */
export class WebSocket {
  constructor(_url: string, _opts?: unknown) {
    throw new Error('ws is Node-only');
  }
}
