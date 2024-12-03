// @license magnet:?xt=urn:btih:d3d9a9a6595521f9666a5e94cc830dab83b65699&dn=expat.txt MIT

import * as fastboot from "./fastboot.mjs";

let device = new fastboot.FastbootDevice();
window.device = device;

// Enable verbose debug logging
fastboot.setDebugLevel(2);

async function connectDevice() {
    let statusField = document.querySelector(".status-field");
    statusField.textContent = "Connecting...";

    try {
        await device.connect();
    } catch (error) {
        statusField.textContent = `Failed to connect to device: ${error.message}`;
        return;
    }

    let product = await device.getVariable("product");
    let serial = await device.getVariable("serialno");
    let status = `Connected to ${product} (serial: ${serial})`;
    statusField.textContent = status;
}

// async function sendFormCommand(event) {
//     event.preventDefault();

//     let inputField = document.querySelector(".command-input");
//     let command = inputField.value;
//     let result = (await device.runCommand(command)).text;
//     document.querySelector(".result-field").textContent = result;
//     inputField.value = "";
// }

async function bootFormFile(event) {
    event.preventDefault();

    let fileField = document.querySelector(".boot-file");
    let file = fileField.files[0];
    await device.bootBlob(file);
    fileField.value = "";
}

async function flashFormFile(event) {
    event.preventDefault();

    let fileField = document.querySelector(".boot-file");
    let file = fileField.files[0];
    await device.flashBlob("boot", file);
    await device.reboot();
    fileField.value = "";
    partField.value = "";
}

// fastboot.configureZip({
//     workerScripts: {
//         inflate: ["../dist/vendor/z-worker-pako.js", "pako_inflate.min.js"],
//     },
// });

// document.querySelector(".command-form").addEventListener("submit", sendFormCommand);
document.querySelector(".connect-button").addEventListener("click", connectDevice);
document.querySelector(".boot-button").addEventListener("click", bootFormFile);
document.querySelector(".flash-button").addEventListener("click", flashFormFile);

// @license-end
