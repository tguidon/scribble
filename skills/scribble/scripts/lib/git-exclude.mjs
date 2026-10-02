import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, appendFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const exec = promisify(execFile);

export async function excludeStorage(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const storage = await realpath(root);
  const git = async (...args) =>
    (await exec("git", ["-C", storage, ...args])).stdout.trimEnd();
  let top;
  try {
    top = await git("rev-parse", "--show-toplevel");
  } catch (error) {
    if (
      error.code === "ENOENT" ||
      /not a git repository/i.test(error.stderr || "")
    )
      return;
    throw error;
  }
  const path = relative(await realpath(top), storage)
    .split(sep)
    .join("/");
  if (!path || path === ".." || path.startsWith("../"))
    throw new Error(
      "Choose a Scribble storage directory inside the project, not the project root.",
    );
  if (await git("ls-files", "-z", "--", `:(top,literal)${path}`))
    throw new Error(
      `Scribble storage is already tracked by Git: ${storage}. Remove it from Git's index before starting. Existing files have been preserved.`,
    );
  const exclude = resolve(
    storage,
    await git("rev-parse", "--git-path", "info/exclude"),
  );
  // Anchor the directory and escape Git's pattern syntax, including trailing spaces.
  const pattern = `/${path.replace(/[\\*?[\] ]/g, "\\$&")}/`;
  const previous = await readFile(exclude, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (previous.split(/\r?\n/).includes(pattern)) return;
  await mkdir(dirname(exclude), { recursive: true });
  await appendFile(
    exclude,
    `${previous && !previous.endsWith("\n") ? "\n" : ""}${pattern}\n`,
  );
}
