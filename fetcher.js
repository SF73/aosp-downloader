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
