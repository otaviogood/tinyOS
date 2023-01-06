# Tiny Quest / Tiny OS
A bunch of video games and apps for small kids

### License?
I'd like to make all the code public domain. Not sure how that works since there are SVG images mixed in there that have other licenses. I got many of the SVG images from [flaticon](https://www.flaticon.com/) and [freepik](https://freepik.com/) and I paid the fee, so it should be attribution-free, but not public domain. Anyway, so consider the code public domain except for inlined-images and other images and sound files.

## Tips for using this
Lock down your device so kids can't wreck your settings.
#### iPad
IPad has something called "Guided Access" that lets you lock the device to using just one app. I still need to look into something called "Single App Mode" on iOS, which might be nicer if it lets the user set volume and sleep the device.

#### Chromebook tablet
I'm also trying Chromebook tablets since the Cutie Pi tablet had some problems. The one I got (Lenovo Duet 3) has a muuucch faster CPU than the Raspberry Pi, better speaker, and a few other nice things. It costs around $50 / year to have the Google account that lets you manage the Chromebook in kiosk mode. That doesn't excite me since it's less open. Anyway, this Chromebook thing is a work in progress. I can't figure out how I'm supposed to set the wifi network if I'm in kiosk mode.

#### CutiePi (Raspberry Pi 4 tablet)
I got a ["Cutie Pi"](https://cutiepi.io/) tablet, which was a Kickstarter project. It's a tablet with a Raspberry Pi inside. I made it boot to a fullscreen browser, so it looks like my app screen is the "real" one.

Pros:
- The hardware feels nice. It's strong and has a nice foldable handle. Great form factor for kids.
- It runs linux, so it's all open source and I can modify it however I want.
- It's easy to make it boot to a fullscreen browser.

Cons:
- The CPU is *slow*. Since I'm trying to be lazy with my game dev, I use html / CSS for graphics, and that's slow. So then my frame rates are dropping a lot and I'm wondering if I should spend my life optimizing stuff for the GPU. No, probably not.
- Too quiet. The speaker is very small. Since I really wanted this to be partly a music device, that leaves much to be desired. At least it's not annoyingly loud like many kids toys. :/
- Drivers and Linuxy stuff! How do I get this camera to work? IDK. Not sure I want to spend my time figuring these things out.


### Get it running (developers)
- clone this
- install npm or whatever
- npm install
- npm run dev

This project uses Svelte, Vite, Tailwind.

### Speech Synthesis
Since the browser's built in speech synthesis gave me trouble, I'm using Google Cloud speech as a preprocess to generate all speech that I put in comments in the files that use that speech. It's pretty sucky. To run it, set GOOGLE_APPLICATION_CREDENTIALS=[your key file], go to the "speech" folder and type node genSpeech.cjs. You will need to supply a key for google cloud though.

### Recommended

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode).

