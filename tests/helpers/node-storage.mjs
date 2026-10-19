import {mkdir,readFile,open,copyFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {validateArchive} from '../../src/knowledge-tree-store.mjs';

// Test-only counterpart to the Gecko adapter. Caller supplies an isolated directory.
export function createNodeStorage(directory) {
  if (!path.isAbsolute(directory)) throw new Error('An absolute test directory is required');
  const file = path.join(directory,'knowledge-tree.json');
  let previouslyExisted = false;
  async function read() {
    let bytes;
    try { bytes = await readFile(file,'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (previouslyExisted) throw new Error('Archive disappeared');
      return null;
    }
    const value = validateArchive(JSON.parse(bytes));
    previouslyExisted = true;
    return value;
  }
  return {
    paths:{directory,file,backup:`${file}.bak`},read,
    async write(value,{expectedRevision}) {
      validateArchive(value);
      const previous = await read();
      if (previous ? previous.revision !== expectedRevision : expectedRevision !== 0) throw new Error('Archive changed on disk');
      await mkdir(directory,{recursive:true});
      const temporary = `${file}.${value.revision}.tmp`;
      const handle = await open(temporary,'wx');
      try { await handle.writeFile(JSON.stringify(value),'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      if (previous !== null) await copyFile(file,`${file}.bak`);
      await rename(temporary,file);
      previouslyExisted = true;
    }
  };
}
