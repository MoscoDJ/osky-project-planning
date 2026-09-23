import { execCmd } from "./fsutil.js";

export class GitError extends Error {}

async function git(cwd: string, args: string[]): Promise<string> {
  const r = await execCmd("git", args, { cwd });
  if (r.code !== 0) {
    throw new GitError(`git ${args.join(" ")} falló (${r.code}): ${r.stderr.trim()}`);
  }
  return r.stdout;
}

export const Git = {
  async init(cwd: string): Promise<void> {
    await git(cwd, ["init", "-q"]);
    await git(cwd, ["config", "user.name", "Osky Debate"]);
    await git(cwd, ["config", "user.email", "debate@localhost"]);
    await git(cwd, ["config", "commit.gpgsign", "false"]);
  },

  async head(cwd: string): Promise<string> {
    return (await git(cwd, ["rev-parse", "HEAD"])).trim();
  },

  async commitAll(cwd: string, message: string): Promise<string> {
    await git(cwd, ["add", "-A"]);
    await git(cwd, ["commit", "-q", "-m", message, "--allow-empty"]);
    return Git.head(cwd);
  },

  /** Archivos con cambios (modificados, nuevos, borrados) respecto a HEAD, sin los ignorados. */
  async changedFiles(cwd: string): Promise<string[]> {
    const out = await git(cwd, ["status", "--porcelain", "--untracked-files=all"]);
    return out
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, ""));
  },

  /** Restaura el árbol de trabajo a HEAD y elimina archivos nuevos no ignorados. */
  async restore(cwd: string): Promise<void> {
    await git(cwd, ["checkout", "-q", "--", "."]);
    await git(cwd, ["clean", "-fdq"]);
  },

  async diff(cwd: string, from: string, to: string, file?: string): Promise<string> {
    const args = ["diff", "--no-color", `${from}..${to}`];
    if (file) args.push("--", file);
    return git(cwd, args);
  },

  /** Devuelve {added, deleted} de un archivo entre dos commits o entre HEAD y el árbol. */
  async numstat(cwd: string, file: string, from?: string, to?: string): Promise<{ added: number; deleted: number }> {
    const args = ["diff", "--numstat"];
    if (from) args.push(to ? `${from}..${to}` : from);
    args.push("--", file);
    const out = await git(cwd, args);
    const line = out.split("\n").find((l) => l.trim());
    if (!line) return { added: 0, deleted: 0 };
    const [a, d] = line.split("\t");
    return { added: Number(a) || 0, deleted: Number(d) || 0 };
  },

  async tag(cwd: string, name: string, message: string): Promise<void> {
    await git(cwd, ["tag", "-f", "-a", name, "-m", message]);
  },

  async log(cwd: string, max = 50): Promise<Array<{ hash: string; subject: string }>> {
    const out = await git(cwd, ["log", `--max-count=${max}`, "--pretty=format:%H%x09%s"]);
    return out
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const [hash, subject] = l.split("\t");
        return { hash, subject };
      });
  },

  async show(cwd: string, ref: string, file: string): Promise<string> {
    return git(cwd, ["show", `${ref}:${file}`]);
  },
};
