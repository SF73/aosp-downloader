function decompressData(compressedData, compressionMethod) {
  if (compressionMethod === 0) {
    console.log("No compression applied.");
    return compressedData;
  } else if (compressionMethod === 8) {
    console.log("Decompressing using the Deflate method.");
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

async function main(url, pattern, filename) {
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

    const bootDataStop = bootDataStart + file.compressedSize;
    const compressedData = await fetcher.fetchRange(url, bootDataStart, bootDataStop);

    const decompressedData = decompressData(compressedData, file.compressionMethod);

    // Verify CRC32
    const computedCrc32 = CRC32.buf(decompressedData);
    if (computedCrc32 !== file.crc32) {
      throw new Error(
        `CRC32 mismatch: computed ${computedCrc32} does not match expected ${file.crc32}.`
      );
    }

    // Save the file
    console.log(`Saving file: ${file.fileName}`);
    saveFile(file.fileName, decompressedData);
    console.log(`File "${file.fileName}" saved successfully.`);
  } catch (error) {
    console.error("Error:", error.message || error);
  }
}
