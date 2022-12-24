// https://cloud.google.com/text-to-speech/docs/before-you-begin#windows
// For windows:
// set GOOGLE_APPLICATION_CREDENTIALS=tinyos-7c514-a8428deb9354.json

// Imports the Google Cloud client library
const textToSpeech = require("@google-cloud/text-to-speech");

// Import other required libraries
const fs = require("fs");
const util = require("util");

const { resolve } = require("path");
const { readdir } = require("fs").promises;

// https://stackoverflow.com/questions/5827612/node-js-fs-readdir-recursive-directory-search
async function* getFiles(dir) {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
        const res = resolve(dir, dirent.name);
        if (dirent.isDirectory()) {
            yield* getFiles(res);
        } else {
            yield res;
        }
    }
}

let allTexts = [];
(async () => {
    for await (const f of getFiles("../src")) {
        let data = fs.readFileSync(f, "utf8");
        let startIndex = 0;
        do {
            startIndex = data.indexOf("/*!speech", startIndex);
            if (startIndex >= 0) {
                startIndex += "/*!speech".length;
                let endIndex = data.indexOf("*/", startIndex);
                if (endIndex >= 0) {
                    // console.log(f);
                    let arr = data.substring(startIndex, endIndex);
                    // console.log(arr); //Do Things
                    allTexts.push.apply(allTexts, eval(arr)); // append array to array
                }
                startIndex = endIndex;
            }
        } while (startIndex >= 0);
    }
    allTexts = Array.from(new Set(allTexts)); // remove duplicates
    console.log("allTexts", allTexts);
    // loop over allTexts array and make each string safe for filenames
    let allTextsClean = [];
    for (let i = 0; i < allTexts.length; i++) {
        let text = allTexts[i];
        text = text.replace(/[^a-zA-Z0-9]/g, "_");
        allTextsClean.push(text);
    }
    // Creates a client
    const client = new textToSpeech.TextToSpeechClient();
    // Call Google speech API for each string in allTexts array
    for (let i = 0; i < allTexts.length; i++) {
        let outFile = "../public/speech/" + allTextsClean[i] + ".mp3";
        if (fs.existsSync(outFile)) continue;
        const text = allTexts[i];
        console.log(text);
        // Construct the request
        const request = {
            input: { text: text },
            // Select the language and SSML voice gender (optional)
            voice: { languageCode: "en-US", ssmlGender: "FEMALE", name: "en-US-Wavenet-F" },
            // select the type of audio encoding
            audioConfig: { audioEncoding: "MP3" },
        };
        // Performs the text-to-speech request
        const [response] = await client.synthesizeSpeech(request);
        // Write the binary audio content to a local file
        const writeFile = util.promisify(fs.writeFile);
        await writeFile(outFile, response.audioContent, "binary");
        // console.log("Audio content written to file: output.mp3");
    }
})();

