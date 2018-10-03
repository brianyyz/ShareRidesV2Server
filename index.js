// Example express application adding the parse-server module to expose Parse
// compatible API routes.

var express = require('express');
var ParseServer = require('parse-server').ParseServer;
var path = require('path');

var databaseUri = process.env.DATABASE_URI || process.env.MONGODB_URI;

if (!databaseUri) {
  console.log('DATABASE_URI not specified, falling back to localhost.');
} 

var api = new ParseServer({
  databaseURI: databaseUri                        || 'mongodb://localhost:27017/dev',
  appId: process.env.APP_ID                       || 'myAppId',
  masterKey: process.env.MASTER_KEY               || '', 
  clientKey: process.env.CLIENT_KEY               || '', 
  restAPIKey: process.env.REST_API_KEY            || '', 
  cloud: process.env.CLOUD_CODE_MAIN              || __dirname + '/cloud/main.js',
  serverURL: process.env.SERVER_URL               || 'http://localhost:1337/parse',  
  publicServerURL: process.env.PUBLIC_SERVER_URL  || "http://localhost:1337/parse",
  appName: process.env.APP_NAME                   || "myAppName",
  userSensitiveFields: ["email"],
  allowClientClassCreation: process.env.ALLOW_CLIENT_CLASS_CREATION                 || false,
  verifyUserEmails: process.env.VERIFY_USER_EMAILS                                  || true,
  preventLoginWithUnverifiedEmail: process.env.PREVENT_LOGIN_WITH_UNVERIFIED_EMAIL  || false,
  verbose: process.env.VERBOSE                                                      || false,
  push: {
      ios: [
        {
          pfx: './certs/APNSProductionCertificateExpires20191101.p12',
          topic: 'edu.self.brianmacdonald.ShareRides',
          production: true
        }
      ]
    },
   // The email adapter
  emailAdapter: {
    module: 'parse-server-simple-mailgun-adapter',
    options: {
      // The address that your emails come from
      fromAddress: 'donotreply@bmacdonald.ca',
      // Your domain from mailgun.com
      domain: 'mg.bmacdonald.ca',
      // Your API key from mailgun.com
      apiKey: process.env.MAILGUN_PRIVATE_API_KEY     || 'myMailgunAPIKey'
    }
  }
  // add comma above
  // custom pages for the email validation and password reset functions
  //  customPages: {
  //  invalidLink: 'http://yourpage/link_invalid.html',
  //  verifyEmailSuccess: 'http://yourpage/verify_email_success.html',
  //  choosePassword: 'http://yourpage/new_password.html',
  //  passwordResetSuccess: 'http://yourpage/sucess.html'
 // }
});
// Client-keys like the javascript key or the .NET key are not necessary with parse-server
// If you wish you require them, you can set them as options in the initialization above:
// javascriptKey, restAPIKey, dotNetKey, clientKey

var app = express();

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));
//app.use('/rw_common', express.static('/public'));
//app.use('/rw_common/assets', express.static('/public/rw_common/assets'));
//app.use('/rw_common/themes', express.static('/public'));

// Serve the Parse API on the /parse URL prefix
var mountPath = process.env.PARSE_MOUNT || '/parse';
app.use(mountPath, api);

// Parse Server plays nicely with the rest of your web routes
app.get('/', function(req, res) {
  //res.status(200).send('Nothing to see here. ShareRides support can be found at /support');
  res.sendFile(path.join(__dirname, 'public/support.html'));
});

app.get('/ShareRides/support', function(req, res) {
  res.sendFile(path.join(__dirname, 'public/support.html'));
});

//app.get('/webaccess', function(req, res) {
//  res.sendFile(path.join(__dirname, 'public/webaccess/index.html'));
//});

var port = process.env.PORT || 1337;
var httpServer = require('http').createServer(app);
httpServer.listen(port, function() {
    console.log('parse-server running on port ' + port + '.');
});

// This will enable the Live Query real-time server
//ParseServer.createLiveQueryServer(httpServer);
