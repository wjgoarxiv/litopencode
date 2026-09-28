# Java — `jdtls`

- **Server command:** `jdtls`
- **Extensions:** `.java`
- **Requires:** a JDK (17+ for recent releases)

## Install

- macOS: `brew install jdtls`
- Otherwise: download the Eclipse JDT Language Server release and put its launcher on `PATH`.

```bash
java -version
command -v jdtls
```

## Troubleshooting

- **Nothing resolves:** `jdtls` needs a recognised project model — Maven (`pom.xml`), Gradle, or an
  Eclipse `.project`. A bare directory of `.java` files gets almost no analysis.
- **First open is very slow:** it builds a workspace index under a data directory. Let it finish.
- **Wrong JDK:** `JAVA_HOME` decides both the server runtime and the project's assumed release. A
  server running on 17 will not analyse a 21-only source feature.

## Honest fallback while unserved

`mvn -q compile` or `gradle compileJava`.

