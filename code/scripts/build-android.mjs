import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../Android/android', import.meta.url));
const env = { ...process.env };
const localJava = fileURLToPath(new URL('../.tools/jdk-21', import.meta.url));
if (!env.JAVA_HOME && existsSync(localJava)) env.JAVA_HOME = localJava;
if (!env.JAVA_HOME && existsSync('C:/Program Files/Android/Android Studio/jbr')) env.JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr';
if (!env.ANDROID_HOME && process.platform === 'win32') env.ANDROID_HOME = `${env.LOCALAPPDATA}/Android/Sdk`;
env.GRADLE_USER_HOME ||= fileURLToPath(new URL('../.cache/gradle', import.meta.url));
const java = spawnSync(env.JAVA_HOME ? `${env.JAVA_HOME}/bin/java` : 'java', ['-version'], { env, encoding: 'utf8' });
const javaVersion = Number((java.stderr || java.stdout || '').match(/version "(\d+)/)?.[1]);
if (java.status !== 0 || !javaVersion || javaVersion < 21 || javaVersion > 24) {
  console.error('Android requires JDK 21 (Gradle supports Java 21–24). Set JAVA_HOME to JDK 21, or run scripts/setup-local-java.ps1 on Windows and leave JAVA_HOME unset.');
  process.exit(1);
}
const win = process.platform === 'win32';
const result = spawnSync(win ? 'cmd.exe' : './gradlew', win ? ['/d', '/c', 'gradlew.bat assembleDebug'] : ['assembleDebug'], { cwd, env, stdio: 'inherit' });
process.exit(result.status ?? 1);
