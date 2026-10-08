/* Classic script: configures Monaco's AMD loader before any ES module runs. */
(function () {
  // Two different bases, and the distinction matters:
  //   vsBase   .../vendor/vs/   — where the vs files physically live
  //   rootBase .../vendor/      — what the AMD loader resolves module ids against
  // A module id is "vs/language/typescript/tsWorker", so the loader must join it
  // onto the PARENT of vs/. Pointing baseUrl at vsBase yields vendor/vs/vs/...
  // and every language service 404s.
  var vsBase = new URL('../vendor/vs/', document.currentScript.src).href;
  var rootBase = new URL('../vendor/', document.currentScript.src).href;

  self.MonacoEnvironment = {
    getWorkerUrl: function () {
      var src =
        'self.MonacoEnvironment = { baseUrl: ' + JSON.stringify(rootBase) + ' };\n' +
        'importScripts(' + JSON.stringify(vsBase + 'base/worker/workerMain.js') + ');';
      return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    },
  };

  window.__monacoReady = new Promise(function (resolve, reject) {
    if (typeof require === 'undefined') {
      reject(new Error('Monaco loader missing — run "npm run vendor" to populate src/renderer/vendor'));
      return;
    }
    require.config({ paths: { vs: vsBase.replace(/\/$/, '') } });
    require(['vs/editor/editor.main'], function () {
      resolve(window.monaco);
    }, function (err) {
      reject(err);
    });
  });
})();
