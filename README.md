# Tiny Quest / Tiny OS
A bunch of video games and apps for small kids

### License?
I'd like to make all the code public domain. Not sure how that works since there are SVG images mixed in there that have other licenses. I got many of the SVG images from [flaticon](https://www.flaticon.com/) and [freepik](https://freepik.com/) and I paid the fee, so it should be attribution-free, but not public domain. Anyway, so consider the code public domain except for inlined-images and other images and sound files.

## Tips for using this
Lock down your device so kids can't wreck your settings.
#### iPad (Best experience so far)
Start by "installing" the "app". Go to https://tiny.quest, click the share button, then "Add to Home Screen". This will make an icon on you homescreen that looks like a normal app, that runs fullscreen.

You can then lock the device to just that app. IPad has something called "Guided Access" that lets you lock the device to using just one app. It took a long time to find it, but there are options for guided access mode that let you enable the sleep and volume buttons. That lets it work like a standalone device that kids can turn on and off themselves. There's also something called "Single App Mode" on iOS, which is related but I haven't looked into it.

#### Chromebook tablet
I'm also trying Chromebook tablets since the Cutie Pi tablet had some problems. The one I got (Lenovo Duet 3) has a muuucch faster CPU than the Raspberry Pi, better speaker, and a few other nice things. It costs around $50 / year to have the Google account that lets you manage the Chromebook in kiosk mode. That doesn't excite me since it's less open and a hassle. I'm not really liking the Chromebook solution and will probably return the one I got. I can't figure out how I'm supposed to set the wifi network if I'm in kiosk mode. I can't figure out how to enable volume buttons.

#### CutiePi (Raspberry Pi 4 tablet)
This was my first attempt at a locked-in tablet experience. I got a ["Cutie Pi"](https://cutiepi.io/) tablet, which was a Kickstarter project. It's a tablet with a Raspberry Pi inside. I made it boot to a fullscreen browser, so it looks like my app screen is the "real" one.

Pros:
- The hardware feels nice. It's strong and has a nice foldable handle. Great form factor for kids.
- It runs linux, so it's all open source and I can modify it however I want.
- It's easy to make it boot to a fullscreen browser.

Cons:
- The CPU is *slow*. Since I'm trying to be lazy with my game dev, I use html / CSS for graphics, and that's slow. So then my frame rates are dropping a lot and I'm wondering if I should spend my life optimizing stuff for the GPU. No, probably not. This is a deal-breaker for me. Some of my games just don't work.
- Too quiet. The speaker is very small. Since I really wanted this to be partly a music device, that leaves much to be desired. At least it's not annoyingly loud like many kids toys. :/
- Drivers and Linuxy stuff! How do I get this camera to work? IDK. Not sure I want to spend my time figuring these things out.


### Get it running (developers)
- clone this
- install npm or whatever
- npm install
- npm run dev

This project uses Svelte, Vite, Tailwind.

#### Recommended
[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode).

### PWA stuff
npm run build
npm run preview

## Generate data

### Music
Go to "speech" folder and run `node youtubeDownload.cjs`. Once you have done that, then you will need to generate the speech synthesis files... see below.

### Speech Synthesis
Since the browser's built in speech synthesis gave me trouble, I'm using Google Cloud speech as a preprocess to generate all speech that I put in comments in the files that use that speech. It's pretty sucky. To run it, set GOOGLE_APPLICATION_CREDENTIALS=[your key file], go to the "speech" folder and type node genSpeech.cjs. You will need to supply a key for google cloud though.

