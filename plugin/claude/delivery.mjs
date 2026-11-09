// A short-lived Node helper keeps filesystem/locking code out of the mod's
// restricted JavaScript environment. It uses the same runtime as the server.
import {
  pollAgentDelivery,
  settleAgentDelivery,
} from "../../skills/scribble/scripts/lib/agent-delivery.mjs";
import { pluginDataDirectory } from "../data-directory.mjs";

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { action, chatId, consumer, item, error } = JSON.parse(
    Buffer.concat(chunks).toString(),
  );
  const directory = pluginDataDirectory();
  if (action === "poll")
    console.log(
      JSON.stringify(await pollAgentDelivery(directory, chatId, consumer)),
    );
  else if (action === "settle") {
    await settleAgentDelivery(directory, chatId, consumer, item, error);
    console.log("null");
  } else throw new Error("Unknown delivery operation.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
