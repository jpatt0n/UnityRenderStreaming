import WS from "jest-websocket-mock";
import Answer from "../src/class/answer";
import Candidate from "../src/class/candidate";
import * as wsHandler from '../src/class/websockethandler';

Date.now = jest.fn(() => 1482363367071);

describe('websocket signaling test in public mode', () => {
  let server: WS;
  let client: WebSocket;
  let client2: WebSocket;
  const connectionId = "12345";
  const connectionId2 = "67890";
  const testsdp = "test sdp";
  const passcode1 = "HOSTBOT";
  const passcode2 = "JOSH";

  beforeAll(async () => {
    wsHandler.reset("public");
    server = new WS("ws://localhost:1234", { jsonProtocol: true });
    client = new WebSocket("ws://localhost:1234");
    await server.connected;
    client2 = new WebSocket("ws://localhost:1234");
    await server.connected;
  });

  afterAll(() => {
    WS.clean();
  });

  test('create session1', async () => {
    expect(client).not.toBeNull();
    await wsHandler.add(client);
  });

  test('create session2', async () => {
    expect(client2).not.toBeNull();
    await wsHandler.add(client2);
  });

  test('create connection from session1', async () => {
    await wsHandler.onConnect(client, connectionId, passcode1);
    await expect(server).toReceiveMessage(expect.objectContaining({
      type: "connect",
      connectionId: connectionId,
      polite: true,
      authProfile: expect.objectContaining({ passcodeId: "hostbot", role: "host", username: "hostbot" })
    }));
  });

  test('create connection from session2', async () => {
    await wsHandler.onConnect(client2, connectionId2, passcode2);
    await expect(server).toReceiveMessage(expect.objectContaining({
      type: "connect",
      connectionId: connectionId2,
      polite: true,
      authProfile: expect.objectContaining({ passcodeId: "josh", role: "host", username: "josh" })
    }));
  });

  test('send offer from session1', async () => {
    await wsHandler.onOffer(client, { connectionId: connectionId, sdp: testsdp });
    await expect(server).toReceiveMessage(expect.objectContaining({
      from: connectionId,
      to: "",
      type: "offer",
      data: expect.objectContaining({ sdp: testsdp, polite: false, authProfile: expect.objectContaining({ passcodeId: "hostbot" }) })
    }));
  });

  test('send answer from session2', async () => {
    await wsHandler.onAnswer(client2, { connectionId: connectionId, sdp: testsdp });
    const receiveAnswer = new Answer(testsdp, Date.now());
    await expect(server).toReceiveMessage({ from: connectionId, to: "", type: "answer", data: receiveAnswer });
    expect(server).toHaveReceivedMessages([{ from: connectionId, to: "", type: "answer", data: receiveAnswer }]);
  });

  test('send candidate from sesson1', async () => {
    const msg = { connectionId: connectionId, candidate: "testcandidate", sdpMLineIndex: 0, sdpMid: "0" };
    await wsHandler.onCandidate(client, msg);
    const receiveCandidate = new Candidate("testcandidate", 0, "0", Date.now());
    await expect(server).toReceiveMessage({ from: connectionId, to: "", type: "candidate", data: receiveCandidate });
    expect(server).toHaveReceivedMessages([{ from: connectionId, to: "", type: "candidate", data: receiveCandidate }]);
  });

  test('delete connection from session2', async () => {
    await wsHandler.onDisconnect(client2, connectionId);
    // disconnect send to client
    await expect(server).toReceiveMessage({ type: "disconnect", connectionId: connectionId });
    // disconnect send to client2
    await expect(server).toReceiveMessage({ type: "disconnect", connectionId: connectionId });
    // server received total 2 disconnect messages
    expect(server).toHaveReceivedMessages([{ type: "disconnect", connectionId: connectionId }, { type: "disconnect", connectionId: connectionId }]);
  });

  test('delete connection from session1', async () => {
    await wsHandler.onDisconnect(client, connectionId);
    await expect(server).toReceiveMessage({ type: "disconnect", connectionId: connectionId });
    expect(server).toHaveReceivedMessages([{ type: "disconnect", connectionId: connectionId }, { type: "disconnect", connectionId: connectionId }]);
  });

  test('delete session2', async () => {
    expect(client).not.toBeNull();
    await wsHandler.remove(client2);
  });

  test('delete session1', async () => {
    expect(client2).not.toBeNull();
    await wsHandler.remove(client);
  });
});

describe('websocket signaling test in private mode', () => {
  let server: WS;
  let client: WebSocket;
  let client2: WebSocket;
  const connectionId = "12345";
  const testsdp = "test sdp";
  const passcode1 = "HOSTBOT";
  const passcode2 = "JOSH";

  beforeAll(async () => {
    wsHandler.reset("private");
    server = new WS("ws://localhost:1234", { jsonProtocol: true });
    client = new WebSocket("ws://localhost:1234");
    await server.connected;
    client2 = new WebSocket("ws://localhost:1234");
    await server.connected;
  });

  afterAll(() => {
    WS.clean();
  });

  test('create session1', async () => {
    expect(client).not.toBeNull();
    await wsHandler.add(client);
  });

  test('create session2', async () => {
    expect(client2).not.toBeNull();
    await wsHandler.add(client2);
  });

  test('create connection from session1', async () => {
    await wsHandler.onConnect(client, connectionId, passcode1);
    await expect(server).toReceiveMessage(expect.objectContaining({
      type: "connect",
      connectionId: connectionId,
      polite: false,
      authProfile: expect.objectContaining({ passcodeId: "hostbot", role: "host", username: "hostbot" })
    }));
  });

  test('create connection from session2', async () => {
    await wsHandler.onConnect(client2, connectionId, passcode2);
    await expect(server).toReceiveMessage(expect.objectContaining({
      type: "connect",
      connectionId: connectionId,
      polite: true,
      authProfile: expect.objectContaining({ passcodeId: "josh", role: "host", username: "josh" })
    }));
  });

  test('send offer from session1', async () => {
    await wsHandler.onOffer(client, { connectionId: connectionId, sdp: testsdp });
    await expect(server).toReceiveMessage(expect.objectContaining({
      from: connectionId,
      to: "",
      type: "offer",
      data: expect.objectContaining({ sdp: testsdp, polite: true, authProfile: expect.objectContaining({ passcodeId: "hostbot" }) })
    }));
  });

  test('send answer from session2', async () => {
    await wsHandler.onAnswer(client2, { connectionId: connectionId, sdp: testsdp });
    const receiveAnswer = new Answer(testsdp, Date.now());
    await expect(server).toReceiveMessage({ from: connectionId, to: "", type: "answer", data: receiveAnswer });
    expect(server).toHaveReceivedMessages([{ from: connectionId, to: "", type: "answer", data: receiveAnswer }]);
  });

  test('send candidate from sesson1', async () => {
    const msg = { connectionId: connectionId, candidate: "testcandidate", sdpMLineIndex: 0, sdpMid: "0" };
    await wsHandler.onCandidate(client, msg);
    const receiveCandidate = new Candidate("testcandidate", 0, "0", Date.now());
    await expect(server).toReceiveMessage({ from: connectionId, to: "", type: "candidate", data: receiveCandidate });
    expect(server).toHaveReceivedMessages([{ from: connectionId, to: "", type: "candidate", data: receiveCandidate }]);
  });

  test('delete connection from session2', async () => {
    await wsHandler.onDisconnect(client2, connectionId);
    // disconnect send to client
    await expect(server).toReceiveMessage({ type: "disconnect", connectionId: connectionId });
    // disconnect send to client2
    await expect(server).toReceiveMessage({ type: "disconnect", connectionId: connectionId });
    // server received total 2 disconnect messages
    expect(server).toHaveReceivedMessages([{ type: "disconnect", connectionId: connectionId }, { type: "disconnect", connectionId: connectionId }]);
  });

  test('delete connection from session1', async () => {
    await wsHandler.onDisconnect(client, connectionId);
    await expect(server).toReceiveMessage({ type: "disconnect", connectionId: connectionId });
    expect(server).toHaveReceivedMessages([{ type: "disconnect", connectionId: connectionId }, { type: "disconnect", connectionId: connectionId }]);
  });

  test('delete session2', async () => {
    expect(client).not.toBeNull();
    await wsHandler.remove(client2);
  });

  test('delete session1', async () => {
    expect(client2).not.toBeNull();
    await wsHandler.remove(client);
  });
});
