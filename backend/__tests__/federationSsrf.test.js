"use strict";

const dns = require("node:dns");

const axios = require("axios");

const {
  UnsafeNetworkTargetError,
  buildDiscoveryUrl,
  isPublicAddress,
  parseSecureUrl,
  secureGet,
} = require("../src/services/secureHttpClient");

jest.mock("axios");

describe("federation SSRF protection", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.255.255",
    "192.168.1.1",
    "::1",
    "fe80::1",
    "fd00:ec2::254",
    "::ffff:127.0.0.1",
  ])("blocks non-public address %s", address => {
    expect(isPublicAddress(address)).toBe(false);
  });

  test.each([
    "https://127.0.0.1/federation",
    "https://%31%32%37.0.0.1/federation",
    "https://2130706433/federation",
    "https://0177.0.0.1/federation",
    "https://0x7f000001/federation",
    "https://[::1]/federation",
    "https://[::ffff:127.0.0.1]/federation",
    "https://metadata.google.internal/federation",
  ])("rejects literal and encoded internal host %s", target => {
    expect(() => parseSecureUrl(target)).toThrow(UnsafeNetworkTargetError);
  });

  it("requires HTTPS and rejects URL credentials", () => {
    expect(() => parseSecureUrl("http://example.com/federation")).toThrow(
      UnsafeNetworkTargetError
    );
    expect(() => parseSecureUrl("https://example.com@127.0.0.1/federation")).toThrow(
      UnsafeNetworkTargetError
    );
  });

  test.each(["example.com:8443", "example.com/path", "example.com?next=127.0.0.1"])(
    "rejects non-domain discovery input %s",
    domain => {
      expect(() => buildDiscoveryUrl(domain)).toThrow(UnsafeNetworkTargetError);
    }
  );

  it("rejects a hostname when any DNS answer is private", async () => {
    jest.spyOn(dns.promises, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);

    await expect(secureGet("https://example.com/federation")).rejects.toThrow(
      UnsafeNetworkTargetError
    );
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("pins the connection to the address that passed validation", async () => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    axios.get.mockResolvedValue({ status: 200, headers: {}, data: { account_id: "G..." } });

    await secureGet("https://example.com/federation");

    const requestOptions = axios.get.mock.calls[0][1];
    const callback = jest.fn();
    requestOptions.httpsAgent.options.lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(requestOptions.maxRedirects).toBe(0);
    expect(requestOptions.proxy).toBe(false);
  });

  it("resolves and revalidates DNS again for every redirect", async () => {
    const lookup = jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    axios.get.mockResolvedValueOnce({
      status: 302,
      headers: { location: "/moved" },
      data: "",
    });

    await expect(secureGet("https://example.com/federation")).rejects.toThrow(
      UnsafeNetworkTargetError
    );
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects to encoded internal IP addresses before connecting", async () => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    axios.get.mockResolvedValueOnce({
      status: 302,
      headers: { location: "https://0x7f000001/latest/meta-data" },
      data: "",
    });

    await expect(secureGet("https://example.com/federation")).rejects.toThrow(
      UnsafeNetworkTargetError
    );
    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
