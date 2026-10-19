const {createRequire}=require('node:module');
const load=createRequire(__filename);
const {chromium}=load(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const launchOptions={headless:true};
if(process.env.CHROMIUM_EXECUTABLE_PATH)launchOptions.executablePath=process.env.CHROMIUM_EXECUTABLE_PATH;
module.exports={chromium,launchOptions};
