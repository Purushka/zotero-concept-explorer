import {validateArchive} from './knowledge-tree-store.mjs';

// Inject privileged Zotero/Gecko APIs. Importing this file performs no disk I/O.
export function createZoteroStorage({dataDirectory,IOUtils,PathUtils}) {
  if (typeof dataDirectory !== 'string' || !/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(dataDirectory)) throw new TypeError('An absolute data directory is required');
  for (const method of ['exists','readJSON','writeJSON','makeDirectory']) {
    if (typeof IOUtils?.[method] !== 'function') throw new TypeError(`IOUtils.${method} is required`);
  }
  if (typeof PathUtils?.join !== 'function') throw new TypeError('PathUtils.join is required');
  const directory = PathUtils.join(dataDirectory,'concept-explorer');
  const file = PathUtils.join(directory,'knowledge-tree.json');
  let previouslyExisted = false;
  return {
    paths:Object.freeze({directory,file,backup:`${file}.bak`}),
    async read() {
      if (!await IOUtils.exists(file)) {
        if (previouslyExisted || await IOUtils.exists(`${file}.bak`)) throw new Error('Knowledge archive is missing but history exists; recovery is required');
        return null;
      }
      const value = validateArchive(await IOUtils.readJSON(file));
      previouslyExisted = true;
      return value;
    },
    async write(value,{expectedRevision}) {
      validateArchive(value);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || value.revision !== expectedRevision + 1) throw new Error('Invalid archive write revision');
      const exists = await IOUtils.exists(file);
      if (exists) {
        const previous = validateArchive(await IOUtils.readJSON(file));
        if (previous.revision !== expectedRevision) throw new Error('Archive changed on disk; reopen before saving');
      } else if (previouslyExisted || expectedRevision !== 0 || await IOUtils.exists(`${file}.bak`)) {
        throw new Error('Archive disappeared; refusing to replace saved sessions');
      }
      await IOUtils.makeDirectory(directory,{ignoreExisting:true,createAncestors:true});
      await IOUtils.writeJSON(file,value,{tmpPath:`${file}.tmp`,backupFile:`${file}.bak`,flush:true,mode:exists ? 'overwrite' : 'create'});
      previouslyExisted = true;
    }
  };
}
