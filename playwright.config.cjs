const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'./browser-tests',timeout:60000,expect:{timeout:15000},fullyParallel:false,workers:1,
 retries:process.env.CI?1:0,forbidOnly:!!process.env.CI,
 reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:8139',trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure',serviceWorkers:'block'},
 projects:[{name:'iphone-small',use:{...devices['iPhone SE'],browserName:'webkit'}},
  {name:'iphone-large',use:{...devices['iPhone 13 Pro Max'],browserName:'webkit'}},
  {name:'chrome',use:{...devices['Desktop Chrome']}}],
 webServer:{command:'node scripts/serve-browser-build.mjs',url:'http://127.0.0.1:8139',reuseExistingServer:false,timeout:20000}
});
