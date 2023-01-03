# Tiny Quest / Tiny OS
A bunch of video games and apps for small kids

### License?
I'd like to make all the code public domain. Not sure how that works since there are SVG images mixed in there that have other licenses. I got many of the SVG images from [flaticon](https://www.flaticon.com/) and [freepik](https://freepik.com/) and I paid the fee, so it should be attribution-free, but not public domain. Anyway, so consider the code public domain except for inlined-images and other images and sound files.

### Get it running
- clone this
- install npm or whatever
- npm install
- npm run dev

This project uses Svelte, Vite, Tailwind.

### Speech Synthesis
Since the browser's built in speech synthesis gave me trouble, I'm using Google Cloud speech as a preprocess to generate all speech that I put in comments in the files that use that speech. It's pretty sucky. To run it, set GOOGLE_APPLICATION_CREDENTIALS=[your key file], go to the "speech" folder and type node genSpeech.cjs. You will need to supply a key for google cloud though.

## Recommended

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode).

