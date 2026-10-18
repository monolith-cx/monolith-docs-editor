// Battery probe plugin (test only, never shipped). The runner drives it by
// evaluating inside this frame; it records what the editor hands it.
(function () {
  window.__probe = { ready: false, panel: { received: [], sent: [], ignored: [] } };

  function startPanel(panelUrl, panelOrigin) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:100%;height:400px;border:0';
    frame.src = panelUrl;
    document.getElementById('panel-host').appendChild(frame);
    window.addEventListener('message', function (event) {
      if (event.source !== frame.contentWindow || event.origin !== panelOrigin) {
        window.__probe.panel.ignored.push({ origin: event.origin, fromPanel: event.source === frame.contentWindow });
        return;
      }
      window.__probe.panel.received.push(event.data);
      if (event.data && event.data.type === 'hello') {
        const reply = { type: 'hello-ack', id: event.data.id };
        frame.contentWindow.postMessage(reply, panelOrigin);
        window.__probe.panel.sent.push(reply);
      }
    });
    window.__probe.panel.frame = true;
  }

  window.Asc.plugin.init = function (data) {
    const info = window.Asc.plugin.info || {};
    window.__probe.ready = true;
    window.__probe.initData = data === undefined ? null : data;
    window.__probe.options = info.options === undefined ? null : info.options;
    window.__probe.infoKeys = Object.keys(info).sort();
    document.getElementById('status').textContent = 'probe ready';
    const opts = info.options || {};
    if (opts.panelUrl && opts.panelOrigin) startPanel(opts.panelUrl, opts.panelOrigin);
  };
  window.Asc.plugin.button = function () {};
})();
