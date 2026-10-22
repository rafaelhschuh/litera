package io.github.rafaelhschuh.litera

/** Limited presentation/lifecycle integration, also usable against the current deployed PWA. */
internal object HostScripts {
    val observe = """
        (() => {
          if (window.top !== window || !window.LiteraAndroid || !document.head) return;
          if (window.__literaHostState) { window.__literaHostState(); return; }
          let pending = false, previous = '';
          const send = () => {
            pending = false;
            const root = document.documentElement;
            const raw = document.querySelector('meta[name="theme-color"]')?.content?.trim();
            if (!/^#[0-9a-f]{6}$/i.test(raw || '')) return;
            const dark = root.dataset.theme === 'dark' || getComputedStyle(root).colorScheme === 'dark';
            const state = JSON.stringify({type:'state',color:raw,dark,reader:/^\/read\/\d+(?:\/|$)/.test(location.pathname)});
            if (state !== previous) { previous = state; window.LiteraAndroid.postMessage(state); }
          };
          const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(send); } };
          new MutationObserver(schedule).observe(document.head,{childList:true,subtree:true,attributes:true,attributeFilter:['content','name']});
          new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-reader-theme','style']});
          addEventListener('popstate',schedule);
          addEventListener('pageshow',schedule);
          window.__literaHostState = schedule;
          schedule();
        })();
    """.trimIndent()

    const val pause = "window.dispatchEvent(new Event('litera-host-pause'));"
    const val resume = "window.dispatchEvent(new Event('litera-host-resume')); window.__literaHostState?.();"
    val back = """
        (() => {
          const modal = document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]');
          if (modal) {
            if (modal instanceof HTMLDialogElement) {
              if (modal.dispatchEvent(new Event('cancel',{cancelable:true})) && modal.open) modal.close();
            } else document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
            return 'handled';
          }
          if (document.fullscreenElement) { document.exitFullscreen(); return 'handled'; }
          // Vue Router records its predecessor, including restored SPA entries.
          if (history.state && Object.prototype.hasOwnProperty.call(history.state,'back')) {
            return history.state.back ? 'history' : 'root';
          }
          const entry = window.navigation?.currentEntry;
          if (entry && Number.isInteger(entry.index)) return entry.index > 0 ? 'history' : 'root';
          return 'native-history';
        })();
    """.trimIndent()
}
