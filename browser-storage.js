/* Origin-private storage: large files stay on disk, never in localStorage. */
(function (root) {
  // createSyncAccessHandle is exposed only inside dedicated workers, so checking
  // for it on the window's prototype incorrectly disables OPFS in Chrome.
  const supportsOPFS = () => !!root.navigator?.storage?.getDirectory;

  async function entry(path, create = false) {
    const parts = path.replace(/^opfs:/, "").split("/");
    if (parts.some(part => !part || part === "." || part === "..")) throw new Error("Invalid storage path.");
    let directory = await navigator.storage.getDirectory();
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create });
    return { directory, name: parts.at(-1) };
  }

  async function handle(path, create = false) {
    const { directory, name } = await entry(path, create);
    return directory.getFileHandle(name, { create });
  }

  async function remove(path) {
    try {
      const { directory, name } = await entry(path);
      await directory.removeEntry(name);
      if (name.endsWith(".img")) {
        await directory.removeEntry(name.slice(0, -4) + ".json").catch(() => {});
      }
    } catch (error) { if (error.name !== "NotFoundError") throw error; }
  }

  async function write(path, produce) {
    let writer;
    try {
      writer = await (await handle(path, true)).createWritable();
      await produce(chunk => writer.write(chunk));
      await writer.close();
      return (await handle(path)).getFile();
    } catch (error) {
      if (writer) await writer.abort().catch(() => {});
      await remove(path).catch(() => {});
      throw error;
    }
  }

  async function copy(path, file) {
    return write(path, async writeChunk => {
      const reader = file.stream().getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          await writeChunk(value);
        }
      } finally { reader.releaseLock(); }
    });
  }

  async function allocate(path, size) {
    const writer = await (await handle(path, true)).createWritable();
    try { await writer.truncate(size); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); await remove(path).catch(() => {}); throw error; }
  }

  async function estimate() {
    const info = await navigator.storage?.estimate?.() || {};
    const persisted = await navigator.storage?.persisted?.() || false;
    return { ...info, persisted, opfs: supportsOPFS() };
  }

  root.UTMStorage = { supportsOPFS, handle, remove, write, copy, allocate, estimate,
    file: async path => (await handle(path)).getFile() };
})(globalThis);
