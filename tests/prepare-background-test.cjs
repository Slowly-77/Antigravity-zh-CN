const fs=require('fs'),path=require('path');
const {readArchive}=require('../build_localized');
const source=readArchive(path.join(__dirname,'../app_localized.asar')).get('dist/preload.js').toString();
fs.writeFileSync(path.join(__dirname,'background-preload.js'),source.slice(source.indexOf('// Localization and chat layout extensions.')));
