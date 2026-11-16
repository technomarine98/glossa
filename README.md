# Selection Translator for Zen

A small, quiet translation companion for Zen Browser. Select English or Russian text on a webpage, and its translation appears beside the selection—no clicks, shortcuts, or extra windows needed.

## What it does

- Translates English to Russian and Russian to English automatically.
- Shows a compact popup near the selected text.
- Lets you copy the translation or swap the language direction.
- Remembers recent translations so repeated selections appear quickly.
- Automatically switches to free Lingva and public LibreTranslate backup servers when the main provider is unavailable.
- Works on regular and dynamically updated webpages.
- Supports light and dark themes.
- Can be turned off everywhere or only on websites you choose.

## Install

### Install a signed release

Download the signed `.xpi` release and open it with Zen Browser. Confirm the installation when the browser asks.

Signed releases are the recommended option for everyday use because they remain installed after restarting the browser.

### Load temporarily for testing

1. Open `about:debugging#/runtime/this-firefox` in Zen.
2. Select **This Firefox**, then **Load Temporary Add-on**.
3. Choose `manifest.json` inside the built extension's `dist` folder.

A temporarily loaded extension is removed when the browser closes.

### Update to 1.1.0

The ready-to-load package is [releases/selection-translator-1.1.0.zip](releases/selection-translator-1.1.0.zip). This ZIP is unsigned and can be loaded temporarily; it is not a signed XPI.

If you loaded the extension from this repository's `dist` folder:

1. Update the repository and run `npm install`, then `npm run build`.
2. Open `about:debugging#/runtime/this-firefox` in Zen and click **Reload** on the extension's card.
3. Reload the webpages where you use the translator and check that the extension version is **1.1.0**.

If you loaded a temporary extension from a ZIP or another folder, download and extract the new ZIP, then use **Load Temporary Add-on** to select its `manifest.json`. Existing settings use the same extension ID.

For a permanently installed extension, a signed **1.1.0 XPI** is required. Once signed, install it through `about:addons` → gear menu → **Install Add-on From File**. Automatic add-on updates require a published, signed release; pushing this repository alone does not update installed copies. Signing requires a Mozilla Add-ons developer account.

## Use

Select a sentence or a few words and pause briefly. The popup appears with a loading indicator and then the translation.

- **Copy** copies the translated text.
- **Swap languages** translates the result back into the other language.
- **Close** or **Escape** dismisses the popup.
- **Retry** appears when a translation request fails.

Password fields, payment-card fields, and one-time-code fields are not translated.

## Settings

Open the extension's settings through Zen's add-ons manager.

You can change:

- Automatic translation and the selection delay.
- The default language direction.
- An optional modifier key required while selecting.
- The translation provider.
- Websites where the extension is disabled.

### Translation providers

**MyMemory** is the default. It requires no account or API key, but its free service has usage limits and may occasionally be unavailable.

MyMemory's [documented allowance](https://mymemory.translated.net/doc/usagelimits.php) is 5,000 characters per day anonymously, or 50,000 with a valid contact email. You can enter an optional **Contact email** in settings to use the higher allowance. That email is sent only to MyMemory, with each MyMemory translation request.

**LibreTranslate** supports a hosted service or your own server. Enter the server URL and, if required, its API key. Zen may ask permission to contact a custom server.

**Google Cloud Translation** uses the official Cloud Translation Basic API. It requires your own API key and a configured Google Cloud account.

**Lingva** uses the public REST API of a Lingva server, which retrieves translations from Google Translate. No API key is needed. You can select Lingva as your main provider and set its server URL.

### Automatic backup services

Automatic switching is enabled by default, including for existing installations. When the main provider reaches a limit, returns a server error, cannot be reached, or times out, the extension tries the configured Lingva servers, then the configured keyless LibreTranslate servers. Each group supports up to two URLs. The default public servers come from the [Lingva instance list](https://github.com/thedaviddelta/lingva-translate#instances) and [LibreTranslate mirrors](https://docs.libretranslate.com/community/mirrors/).

Requests have bounded timeouts (8 seconds for the main provider, 4 seconds for each backup). Rate-limited servers retain their provider-supplied cooldown. Other unavailable servers are skipped for 30 seconds. The main provider is tried again after its cooldown, and the popup names the service that produced the translation, marking backup results.

In **Backup translation services**, disable automatic switching to use only your main provider, or change the server lists. Empty lists skip that service. Zen requests permission when you save a new server address. Backup servers receive only the selected text and language direction, never your primary provider's API keys or contact email. Closing the popup or selecting different text cancels the pending chain. Configuration errors, such as a missing Google API key, are shown directly.

Public community servers can have limits or outages. Live checks during preparation of 1.1.0 returned errors or timeouts for the default public endpoints; the switching logic is covered by automated tests, but their live availability is not guaranteed. If all services are unavailable, the popup reports the failure and enables Retry after the earliest cooldown expires.

### Too many requests (429)

A 429 error means your provider is limiting requests or your usage allowance has been reached. The extension spaces requests apart and pauses new requests to that provider after a rate limit response. It respects the provider's retry time when supplied; otherwise it pauses for one minute. **Retry** shows the remaining wait and becomes available afterward. Cached translations still work during the pause. Cooldowns survive the background process going idle and are cleared when the browser closes.

For a daily allowance, wait for it to reset or change providers in settings. Increasing the selection delay helps avoid requests while adjusting a selection, but does not increase a daily allowance.

## Privacy

The extension sends the text you select to your chosen provider. With automatic switching enabled, that text can also be sent to the configured Lingva and LibreTranslate backup servers if earlier services fail. It does not send entire pages or browsing history. Lingva retrieves translations from Google Translate. Disable automatic switching if you want selected text sent only to your main provider.

Provider requests are subject to that provider's own privacy policy. Translation settings, any API keys, and the optional MyMemory contact email you enter are stored locally in the browser. Recent translations are cached temporarily in memory. Provider cooldowns are kept in browser session storage, which is cleared when the browser closes.

## Build from source

You need Node.js and npm.

```bash
npm install
npm run build
```

The finished extension is placed in `dist/`.

To check types and build in one step:

```bash
npm run check
```

To build a versioned ZIP for temporary installation or add-on submission (requires the `zip` command):

```bash
npm run package
```

The ZIP is written to `releases/selection-translator-1.1.0.zip`, with `manifest.json` at its root. For permanent installation, submit it through the Firefox Add-ons developer hub for signing.

## License

Released under the [MIT License](LICENSE). You may use, study, modify, and share it, including in commercial projects, as long as the license and copyright notice are preserved.
