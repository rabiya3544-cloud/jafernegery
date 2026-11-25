# Jafernegery Video Explore

A mobile-first, dark-themed video archive for browsing and streaming public videos associated with `@jafernegery`. The interface displays a three-column gallery, supports infinite scrolling, opens videos in a full-screen player, and provides download controls.

**Live site:** https://jafernegery.vercel.app/

## Features

- Responsive 9:16 video gallery
- Infinite scrolling and paginated loading
- Built-in video player with play, pause, mute, close, and download controls
- Post date and like count metadata
- Loading, empty, and retry states
- Mobile-safe layout with safe-area support
- Dark teal visual theme and Font Awesome icons
- PWA metadata, favicons, Open Graph, and Twitter card tags

## How It Works

The frontend is a static HTML/CSS/JavaScript application.

- `public/index.html` provides the profile, gallery, tabs, and video player markup.
- `public/style.css` implements the responsive layout and dark teal theme.
- `public/app.js` fetches paginated video data and handles streaming and downloads.

The application requests videos from:

```text
https://b2-storage-kappa.vercel.app/api/explore-videos
```

API requests include:

- `userId=jafernegery`
- `limit=60`
- `offset=<page-offset>`
- `X-API-Key` when an API key is available

The API key is read from browser `localStorage` under `xapiKey`.

## Run Locally

Because the project is static, serve the `public` directory with any local HTTP server.

### Python

```bash
python3 -m http.server 8080 --directory public
```

Open `http://localhost:8080`.

### Node.js

```bash
npx serve public
```

## Deploy

The repository can be deployed on Vercel or any static hosting provider:

1. Import the repository.
2. Set the output/root directory to `public` if required by the hosting provider.
3. Deploy.

For a Vercel deployment, configure the project so that `public/index.html` is the web entry point.

## Project Structure

```text
public/
├── index.html        # Page structure, metadata, and PWA links
├── style.css         # Layout, components, theme, and player styles
├── app.js            # API integration and application behavior
├── IMG_7379.png      # Avatar and app icon
├── manifest.webmanifest
└── og-cover.jpg
```

## Browser Support

The app uses standard modern browser APIs, including `fetch`, `URLSearchParams`, `async/await`, `localStorage`, and CSS features such as `backdrop-filter`. Use an up-to-date browser for the best experience.

## API and Security Note

Do not expose private credentials in frontend source code or commit sensitive API keys to this repository. The API key used by this demo is stored in browser `localStorage`; production deployments should use properly secured backend authentication and appropriately scoped API access.

## License

No license is currently included in this repository. Add a license file if you intend to permit reuse or distribution.
