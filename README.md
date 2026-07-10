<<<<<<< HEAD
# 📱 Instagram Inactive Followers

A browser-based tool to find and remove inactive followers on Instagram — no downloads or installations required.

**[→ Open the tool](https://elisagigliotti.github.io/InstaInactiveFollowers/)**

---

## What it does

- **👻 Ghost accounts** — finds followers with 0 posts
- **💤 Inactive accounts** — finds followers who haven't posted in 3, 6, 12 or 24 months
- **🤍 Whitelist** — protect accounts you want to keep (saved in your browser)
- **🗑️ Remove** — remove selected followers directly from the tool
- **🔒 Private** — no external servers, everything stays between your browser and Instagram

## How to use

1. Open the tool page and click **COPY**
2. Go to [instagram.com](https://www.instagram.com) and log in
3. Open the browser console:
   - Windows: `Ctrl + Shift + J`
   - Mac: `⌘ + ⌥ + J`
4. Paste the code and press Enter
5. Click **RUN** and wait for the scan

## Settings

| Option | Description |
|---|---|
| 0 post accounts | Include followers with no posts at all |
| Check last post date | Fetch each user's feed to find last post date (slower) |
| Inactive since | Threshold: 3 months, 6 months, 1 year, 2 years |

## Notes

- Scanning speed depends on how many followers you have
- The "check last post date" option makes one extra API call per follower — expect 2–3 seconds per user
- Use the whitelist to protect accounts you care about
- Whitelist is stored in `localStorage` and persists between sessions

## ⚠️ Disclaimer

This tool is **not affiliated** with Instagram or Meta. Use at your own risk. Avoid removing too many followers in a short time to prevent temporary rate-limiting by Instagram.

## License

MIT — free to use, copy, and modify.
=======
# InstaInactiveFollowers
>>>>>>> c6242d23ee1eea76e7ee074e73347334b2c1e04d
