/* Lifecycle API follows Zotero's official Make It Red example and developer docs.
 * This plugin is AGPL-3.0-or-later. No upstream application code is bundled. */
var conceptRuntime;
var conceptChrome;
function install() {}
function uninstall() {}
async function startup({id,version,rootURI}) {
  await Zotero.initializationPromise;
  const registrar = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup);
  conceptChrome = registrar.registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [
    ['content','concept-explorer',rootURI + 'content/']
  ]);
  const scope = {Zotero,Services,IOUtils,PathUtils,Components,ChromeUtils,URL};
  Services.scriptloader.loadSubScript(rootURI + 'content/runtime.js',scope);
  scope.ConceptExplorerRuntime.omitOwnStartupTabs(Zotero.Session?.state);
  await Zotero.uiReadyPromise;
  conceptRuntime = await scope.ConceptExplorerRuntime.start({id,version,rootURI});
}
function onMainWindowLoad({window}) { conceptRuntime?.addWindow(window); }
function onMainWindowUnload({window}) { conceptRuntime?.removeWindow(window); }
async function shutdown() {
  await conceptRuntime?.shutdown();
  conceptRuntime = undefined;
  conceptChrome?.destruct();
  conceptChrome = undefined;
}
