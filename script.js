window.addEventListener("load", () => {

    const logContainer = document.getElementById('console-output');

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = function (...messages) {
        handleLog("LOG", messages);
        originalLog.apply(console, messages);
    };

    console.warn = function (...messages) {
        handleLog("WARN", messages);
        originalWarn.apply(console, messages);
    };

    console.error = function (...messages) {
        handleLog("ERROR", messages);
        originalError.apply(console, messages);
    };

    function handleLog(type, messages) {
        const logEntry = document.createElement('div');

        switch (type) {
            case "ERROR":
                logEntry.className = "text-danger";
                break;
            case "WARN":
                logEntry.className = "text-warning";
        }
        const formattedMessages = messages
            .map(msg => (typeof msg === 'object' ? JSON.stringify(msg, null, 2) : msg))
            .join(' ');

        logEntry.textContent = `[${type.toUpperCase()}] ${formattedMessages}`;
        logContainer.appendChild(logEntry);

        logContainer.scrollTop = logContainer.scrollHeight;
    }

    document.getElementById('processButton').addEventListener('click', async () => {
        const url = document.getElementById('urlInput').value;
        const patternText = document.getElementById('patternInput').value;
        const filename = document.getElementById('filenameInput').value;
        const proxyurl = document.getElementById('proxyInput').value;
        const useProxy = document.getElementById('useProxyCheckbox').checked;

        try {
            const pattern = new RegExp(patternText);
            const finalUrl = useProxy ? proxyurl.replace('@', url) : url;
            await main(finalUrl, pattern, filename);
        } catch (error) {
            console.error("An error occurred:", error.message || error);
        }
    });

    // Upload File
    document.getElementById("uploadFile").addEventListener('click', async () => {
        const fileInput = document.getElementById("fileInput");
        const file = fileInput.files[0];
        if (!file) return alert("Please select a file!");

        // Read the file as an ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // Compress the file
        const compressed = pako.deflate(new Uint8Array(arrayBuffer));
        console.log("Original size:", arrayBuffer.byteLength);
        console.log("Compressed size:", compressed.byteLength);

        if (compressed.byteLength > 25 * 1024 * 1024) {
            return console.error("Payload too big, should not exceed 25Mo");
        }
        // Create a Blob for upload
        const compressedBlob = new Blob([compressed], { type: "application/octet-stream" });

        // Upload the compressed file
        const formData = new FormData();
        formData.append("file", compressedBlob, file.name);

        const response = await fetch("https://blob-transfer.sylvainfinot.workers.dev/upload", {
            method: "POST",
            body: formData,
        });

        const uploadOutput = document.getElementById("generated-code");
        if (response.ok) {
            const data = await response.json();
            uploadOutput.innerHTML = `<a href="${data.link}" target="_blank" class="link-body-emphasis link-offset-2">${data.code}</a>`;
        } else {
            uploadOutput.textContent = `Error uploading file`;
        }
    });

    // Download File
    document.getElementById("downloadFile").addEventListener('click', async () => {
        const downloadCode = document.getElementById("downloadCode").value.trim();
        if (!downloadCode) return alert("Please enter a file key!");

        try {
            const response = await fetch(`https://blob-transfer.sylvainfinot.workers.dev/download/${downloadCode}`);
            if (!response.ok) {
                console.error("Error: File not found or expired");
                return;
            }

            const compressedBlob = await response.blob();

            const contentDisposition = response.headers.get("Content-Disposition");
            const match = contentDisposition && contentDisposition.match(/filename="(.+?)"/);
            const filename = match ? match[1] : "decompressed_file";

            // Read the compressed blob as an ArrayBuffer
            const compressedArrayBuffer = await compressedBlob.arrayBuffer();

            // Decompress the file using pako.inflate
            const decompressed = pako.inflate(new Uint8Array(compressedArrayBuffer));
            console.log("Decompressed size:", decompressed.byteLength);

            // Create a Blob for the decompressed file
            const originalBlob = new Blob([decompressed], { type: "application/octet-stream" });

            // Trigger download
            const downloadUrl = URL.createObjectURL(originalBlob);
            const link = document.createElement("a");
            link.href = downloadUrl;
            link.download = filename; // Replace with original filename if stored
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error(`Error downloading file: ${error.message}`);
        }
    })
});