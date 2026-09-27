// Brief 02 task 2 / plan section 5: a headless stand-in for the browser
// editor -- a gc:false Y.Doc, a real HocuspocusProvider talking to the relay
// over a real WebSocket, and a RemoteEditor driving it exactly as
// `ySyncPlugin` would on every local transaction.
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { RemoteEditor } from './remote-editor.js';

export interface RemoteClientOptions {
  url: string;
  docName: string;
}

export class RemoteClient {
  readonly ydoc: Y.Doc;
  readonly provider: HocuspocusProvider;
  readonly editor: RemoteEditor;

  constructor(opts: RemoteClientOptions) {
    this.ydoc = new Y.Doc({ gc: false });
    this.provider = new HocuspocusProvider({
      url: opts.url,
      name: opts.docName,
      document: this.ydoc,
    });
    this.editor = new RemoteEditor(this.ydoc);
  }

  get isSynced(): boolean {
    return this.provider.isSynced;
  }

  /**
   * Resolves once this client has completed its initial sync with the
   * relay. `HocuspocusProvider`'s own `EventEmitter` has no `once`, so this
   * wires up `on` and removes the listener itself either way.
   */
  async synced(timeoutMs = 5000): Promise<void> {
    if (this.provider.isSynced) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.provider.off('synced', onSynced);
        reject(new Error('RemoteClient.synced: timed out'));
      }, timeoutMs);
      const onSynced = () => {
        clearTimeout(timer);
        this.provider.off('synced', onSynced);
        resolve();
      };
      this.provider.on('synced', onSynced);
    });
  }

  destroy(): void {
    this.provider.destroy();
  }
}
