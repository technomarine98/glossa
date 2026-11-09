# Selection Translator for Zen

A small, quiet translation companion for Zen Browser. Select English or Russian text on a webpage, and its translation appears beside the selection—no clicks, shortcuts, or extra windows needed.

## What it does

- Translates English to Russian and Russian to English automatically.
- Shows a compact popup near the selected text.
- Lets you copy the translation or swap the language direction.
- Remembers recent translations so repeated selections appear quickly.
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

**LibreTranslate** supports a hosted service or your own server. Enter the server URL and, if required, its API key. Zen may ask permission to contact a custom server.

**Google Cloud Translation** uses the official Cloud Translation Basic API. It requires your own API key and a configured Google Cloud account.

## Privacy

The extension sends only the text you select to the translation provider you choose. It does not send entire pages, cookies, or browsing history.

Provider requests are subject to that provider's own privacy policy. Translation settings and any API keys you enter are stored locally in the browser. Recent translations are cached temporarily in memory.

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

To create a ZIP for add-on submission:

```bash
(cd dist && zip -r ../selection-translator-1.0.0.zip .)
```

The ZIP must contain `manifest.json` at its root, not inside another folder. For permanent public installation, submit the ZIP through the Firefox Add-ons developer hub for signing.

## License

Released under the [MIT License](LICENSE). You may use, study, modify, and share it, including in commercial projects, as long as the license and copyright notice are preserved.
