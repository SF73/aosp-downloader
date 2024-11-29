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
  