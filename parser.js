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
