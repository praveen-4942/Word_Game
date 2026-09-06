# Word Duel

Word Duel is a two-player word guessing game built with Next.js, TypeScript, Tailwind CSS, and Firebase Authentication/Firestore.

## Run locally

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Copy `.env.local.example` to `.env.local` and fill in the Firebase web app values before using multiplayer synchronization. The Firebase web configuration is safe to expose in a browser application; access is controlled by Firebase Authentication and Firestore Rules.

## Firebase setup

Enable Anonymous Authentication and Firestore in the Firebase project, then deploy the included rules:

```bash
firebase deploy --only firestore:rules
```

For Vercel, add every `NEXT_PUBLIC_FIREBASE_*` value from `.env.local` to the project Environment Variables settings.

## Validate

```bash
npm run lint
npm run build
```

## Deploy

Push this repository to GitHub and import it into Vercel. Vercel detects the Next.js build automatically.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
