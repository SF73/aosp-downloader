function decompressData(compressedData, compressionMethod) {
    if (compressionMethod === 0) {
        console.log("No compression applied.");
        return compressedData;
    } else if (compressionMethod === 8) {
        console.log("Decompressing using inflateRaw.");
        return pako.inflateRaw(compressedData);
    } else {
        throw new Error(`Unsupported compression method: ${compressionMethod}`);
    }
}

function saveFile(filename, data) {
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function genPythonCommand(url, start, stop, crc32) {
    return `python -c "import urllib.request as u,zlib as z,binascii as b;r=u.urlopen(u.Request('${url}',headers={'Range':'bytes=${start}-${stop}'}));d=z.decompress(r.read(),-15);c=b.crc32(d)&0xffffffff;e=${crc32};print('CRC32: %08x should be %08x'%(c, e));open('boot.img','wb').write(d)"`
}

async function main(url, pattern, filename, rawUrl) {
    const fetcher = new RemoteFileFetcher();
    const parser = new ZipCentralDirectoryParser();

    try {
        // Step 1: Fetch the last 64 KB
        console.log("Fetching the last 64 KB of the ZIP file...");
        const lastBytes = await fetcher.fetchLastNBytes(url, 65536);

        // Step 2: Locate EOCD
        console.log("Locating EOCD signature...");
        const eocdOffset = parser.findEOCD(lastBytes);
        console.log(`EOCD located at offset ${eocdOffset}.`);

        // Step 3: Parse EOCD
        const eocdData = lastBytes.slice(eocdOffset, eocdOffset + ZipCentralDirectoryParser.EOCD_SIZE);
        const eocdInfo = parser.parseEOCD(eocdData);

        const { centralDirectoryOffset, centralDirectorySize } = eocdInfo;

        // Step 4: Fetch the central directory
        console.log("Fetching central directory...");
        const centralDirectoryData = await fetcher.fetchRange(
            url,
            centralDirectoryOffset,
            centralDirectoryOffset + centralDirectorySize - 1
        );

        // Step 5: Parse central directory
        console.log("Parsing central directory...");
        const entries = parser.parseCentralDirectory(centralDirectoryData);

        // Step 6: Locate inner ZIP matching the pattern
        const innerZip = entries.find(entry => pattern.test(entry.fileName));
        if (!innerZip) {
            throw new Error(`No file matching pattern ${pattern} found.`);
        }
        console.log(`Inner ZIP found: ${innerZip.fileName} at offset ${innerZip.offset}.`);

        // Step 7: Fetch and unpack local file header
        const localHeaderData = await fetcher.fetchRange(
            url,
            innerZip.offset,
            innerZip.offset + LocalFileHeader.FIXED_SIZE - 1
        );

        const imageFileHeader = LocalFileHeader.unpack(localHeaderData, "", new Uint8Array());
        const localHeaderSize = LocalFileHeader.FIXED_SIZE +
            imageFileHeader.extraFieldLength +
            imageFileHeader.fileNameLength;

        if (innerZip.compressedSize !== imageFileHeader.compressedSize) {
            throw new Error("Mismatch between central directory and local file header sizes.");
        }

        // Step 8: Fetch and decompress inner ZIP data
        const endOfImageZip = innerZip.offset + localHeaderSize + innerZip.compressedSize;
        const imageZipLastBytes = await fetcher.fetchRange(url, endOfImageZip - 65536, endOfImageZip - 1);
        const imageZipEocdOffset = parser.findEOCD(imageZipLastBytes);

        const imageZipEocdData = imageZipLastBytes.slice(
            imageZipEocdOffset,
            imageZipEocdOffset + ZipCentralDirectoryParser.EOCD_SIZE
        );

        const imageZipEocdInfo = parser.parseEOCD(imageZipEocdData);
        const absoluteCentralDirectoryOffset =
            innerZip.offset +
            imageZipEocdInfo.centralDirectoryOffset +
            localHeaderSize;

        const innerCentralDirectoryData = await fetcher.fetchRange(
            url,
            absoluteCentralDirectoryOffset,
            absoluteCentralDirectoryOffset + imageZipEocdInfo.centralDirectorySize - 1
        );

        const nestedEntries = parser.parseCentralDirectory(innerCentralDirectoryData);

        // Step 9: Locate the desired file in the inner ZIP
        const file = nestedEntries.find(entry => entry.fileName === filename);
        if (!file) {
            throw new Error(`File "${filename}" not found in inner ZIP.`);
        }

        console.log(
            `File found: ${file.fileName}, CRC32: ${file.crc32.toString(16)}, ` +
            `Compressed size: ${file.compressedSize}, Uncompressed size: ${file.uncompressedSize}`
        );

        // Step 10: Fetch and decompress the file data
        const bootDataStart =
            innerZip.offset +
            localHeaderSize +
            file.offset +
            LocalFileHeader.FIXED_SIZE +
            file.fileNameLength +
            file.extraFieldLength;

        const bootDataStop = bootDataStart + file.compressedSize - 1;
        const compressedData = await fetcher.fetchRange(url, bootDataStart, bootDataStop);

        const decompressedData = decompressData(compressedData, file.compressionMethod);

        // Verify CRC32
        const computedCrc32 = CRC32.buf(decompressedData) >>> 0;
        if (computedCrc32 !== file.crc32) {
            console.error(
                `CRC32 mismatch: computed ${computedCrc32} does not match expected ${file.crc32}.`
            );
        }

        // Save the file
        console.log(`Saving file: ${file.fileName}`);
        saveFile(file.fileName, decompressedData);
        console.log(`Python command to download and decompress the file:`);
        console.log(genPythonCommand(rawUrl, bootDataStart, bootDataStop, file.crc32));
        console.log(`File "${file.fileName}" saved successfully.`);
    } catch (error) {
        console.error("Error:", error.message || error);
    }
}


class ZipCentralDirectoryParser {
    static EOCD_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];
    static EOCD_SIZE = 22;

    static CENTRAL_DIRECTORY_HEADER_SIGNATURE = new Uint8Array([0x50, 0x4b, 0x01, 0x02]);

    findEOCD(data) {
        for (let i = data.length - ZipCentralDirectoryParser.EOCD_SIZE; i >= 0; i--) {
            if (
                data[i] === ZipCentralDirectoryParser.EOCD_SIGNATURE[0] &&
                data[i + 1] === ZipCentralDirectoryParser.EOCD_SIGNATURE[1] &&
                data[i + 2] === ZipCentralDirectoryParser.EOCD_SIGNATURE[2] &&
                data[i + 3] === ZipCentralDirectoryParser.EOCD_SIGNATURE[3]
            ) {
                return i;
            }
        }
        throw new Error("EOCD signature not found.");
    }

    parseEOCD(eocdData) {
        const view = new DataView(eocdData.buffer);
        return {
            totalEntries: view.getUint16(10, true),
            centralDirectorySize: view.getUint32(12, true),
            centralDirectoryOffset: view.getUint32(16, true),
        };
    }

    parseCentralDirectory(centralDirectoryData) {
        const entries = [];
        let offset = 0;

        while (offset < centralDirectoryData.length) {
            const signature = centralDirectoryData.slice(offset, offset + 4);
            if (!this.compareSignatures(signature, ZipCentralDirectoryParser.CENTRAL_DIRECTORY_HEADER_SIGNATURE)) {
                throw new Error("Invalid central directory file header signature.");
            }

            const fixedHeaderData = centralDirectoryData.slice(
                offset,
                offset + CentralDirectoryFileHeader.FIXED_SIZE
            );
            const centralDirectoryEntry = CentralDirectoryFileHeader.unpack(
                fixedHeaderData, // Fixed-size data
                "",
                new Uint8Array(),
                ""
            );

            // Parse variable-length fields
            const fileNameStart = offset + CentralDirectoryFileHeader.FIXED_SIZE;
            const fileNameEnd = fileNameStart + centralDirectoryEntry.fileNameLength;
            centralDirectoryEntry.fileName = new TextDecoder().decode(
                centralDirectoryData.slice(fileNameStart, fileNameEnd)
            );

            const extraFieldStart = fileNameEnd;
            const extraFieldEnd = extraFieldStart + centralDirectoryEntry.extraFieldLength;
            centralDirectoryEntry.extraField = centralDirectoryData.slice(
                extraFieldStart,
                extraFieldEnd
            );

            const fileCommentStart = extraFieldEnd;
            const fileCommentEnd =
                fileCommentStart + centralDirectoryEntry.fileCommentLength;
            centralDirectoryEntry.fileComment = new TextDecoder().decode(
                centralDirectoryData.slice(fileCommentStart, fileCommentEnd)
            );

            // Update offset for next entry
            offset +=
                CentralDirectoryFileHeader.FIXED_SIZE +
                centralDirectoryEntry.fileNameLength +
                centralDirectoryEntry.extraFieldLength +
                centralDirectoryEntry.fileCommentLength;

            entries.push(centralDirectoryEntry);
        }

        return entries;
    }

    compareSignatures(sig1, sig2) {
        return sig1.length === sig2.length && sig1.every((byte, i) => byte === sig2[i]);
    }

}


class RemoteFileFetcher {
    async fetchLastNBytes(url, nBytes) {
        return this.fetchRange(url, "", nBytes);
    }

    async fetchRange(url, startByte, endByte) {
        const response = await fetch(url, {
            headers: { Range: `bytes=${startByte}-${endByte}` },
        });
        if (response.status === 206) {
            const arrayBuffer = await response.arrayBuffer();
            return new Uint8Array(arrayBuffer);
        }
        throw new Error("Failed to fetch byte range.");
    }
}


class LocalFileHeader {
    static FIXED_SIZE = 30;

    static unpack(data, fileName, extraField) {
        if (data.length < LocalFileHeader.FIXED_SIZE) {
            throw new Error("Local file header is incomplete or corrupted.");
        }

        const view = new DataView(data.buffer);
        return {
            signature: new Uint8Array(data.slice(0, 4)), // First 4 bytes
            versionNeededToExtract: view.getUint16(4, true),
            generalPurposeBitFlag: view.getUint16(6, true),
            compressionMethod: view.getUint16(8, true),
            lastModTime: view.getUint16(10, true),
            lastModDate: view.getUint16(12, true),
            crc32: view.getUint32(14, true),
            compressedSize: view.getUint32(18, true),
            uncompressedSize: view.getUint32(22, true),
            fileNameLength: view.getUint16(26, true),
            extraFieldLength: view.getUint16(28, true),
            fileName: fileName || "",
            extraField: extraField || new Uint8Array(),
        };
    }
}

class CentralDirectoryFileHeader {
    static FIXED_SIZE = 46; // Fixed size of the central directory file header


    static unpack(data, fileName, extraField, fileComment) {
        if (data.length < CentralDirectoryFileHeader.FIXED_SIZE) {
            throw new Error("Central directory file header is incomplete or corrupted.");
        }

        const view = new DataView(data.buffer);

        return {
            signature: new Uint8Array(data.slice(0, 4)),
            versionMadeBy: view.getUint16(4, true),
            versionNeededToExtract: view.getUint16(6, true),
            generalPurposeBitFlag: view.getUint16(8, true),
            compressionMethod: view.getUint16(10, true),
            lastModTime: view.getUint16(12, true),
            lastModDate: view.getUint16(14, true),
            crc32: view.getUint32(16, true),
            compressedSize: view.getUint32(20, true),
            uncompressedSize: view.getUint32(24, true),
            fileNameLength: view.getUint16(28, true),
            extraFieldLength: view.getUint16(30, true),
            fileCommentLength: view.getUint16(32, true),
            diskNumberStart: view.getUint16(34, true),
            internalFileAttributes: view.getUint16(36, true),
            externalFileAttributes: view.getUint32(38, true),
            offset: view.getUint32(42, true),
            fileName: fileName || "",
            extraField: extraField || new Uint8Array(),
            fileComment: fileComment || "",
        };
    }
}
