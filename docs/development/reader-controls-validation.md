# Reader controls and Android status bar

The reader uses the application `UiDialog`, `UiButton` and `UiSwitch` primitives. Control styling is centralized in `src/web/reader-controls.css`; EPUB/PDF rendering and format-aware locators remain in their existing reader paths. The modal handles Tab/Shift+Tab, Escape and return focus. Reading shortcuts do not navigate the book while a panel is open. Tab reveals hidden controls before moving focus into the toolbar. Search is available from settings on narrow screens.

Automatic synchronization does not announce queue counts, in-flight sends or successful completion. Storage/session errors and explicit progress conflicts remain visible. Choosing the server position preserves the existing conflict-resolution semantics.

`theme.ts` updates the page's `theme-color` from the active CSS surface, including system appearance changes, reading-theme changes, original/adapted PDF switches and reader exit. Controls and native form color scheme follow the active reader theme without changing the account's application-theme preference. The manifest supplies the existing startup fallback; it cannot encode a changing reading preference.

## Automated checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e -- --project=chromium --project=chromium-mobile
docker build -t litera:reader-controls .
```

`tests/e2e/reader.spec.ts` covers held progress requests without notices, real revision conflicts and accepting the server locator, light/sepia/dark colors, system-theme changes, original/adapted PDF switches, 320/390/768/1280px toolbar bounds, modal keyboard navigation and mobile search. The existing suite also checks reading restoration, selection, touch, EPUB content isolation, original PDF rendering, adaptation and offline reading.

## Physical Android / Chrome installation

Browser tests verify DOM/CSS and the color declared to Chrome. They do not certify Android's native status bar rendering. After deploying and accepting the PWA update, record Android version, Chrome version and device model, then:

1. Launch the installed PWA and verify the persistent status bar around the camera in light/dark application themes.
2. Open EPUB and switch Claro → Sépia → Escuro. Verify the status bar, toolbar and content, then rotate.
3. Open PDF and switch Documento original → Texto adaptado → Documento original.
4. Return to the catalog and verify that the account's application theme is restored.
5. Read through several screen turns online and offline. Automatic progress saves must not display banners; create a competing position on another device and verify the explicit conflict action.

The expanded Android notification shade is controlled by the OS; this change targets the persistent status bar. For Chrome's supported page-level control, see [theme-color documentation](https://developer.chrome.com/docs/lighthouse/pwa/themed-omnibox).
