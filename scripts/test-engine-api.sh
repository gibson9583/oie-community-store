#!/usr/bin/env bash
# Runs service checks against read-only engine API jars. Does not boot an engine or use a DB.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${OIE_HOME:?Set OIE_HOME to an OIE distribution or server/setup directory}"
mvn -q -Dskip.npm=true -Dskip.installnodenpm=true test-compile dependency:build-classpath -Dmdep.outputFile=target/test-classpath.txt
store_test_cp="target/classes:target/test-classes:$OIE_HOME/server-lib/mirth-server.jar:$OIE_HOME/server-lib/mirth-client-core.jar"
while IFS= read -r -d '' store_jar; do store_test_cp="$store_test_cp:$store_jar"; done < <(find "$OIE_HOME/server-lib" "$OIE_HOME/client-lib" -name '*.jar' -print0)
store_test_cp="$store_test_cp:$(cat target/test-classpath.txt)"
java -Djava.awt.headless=true -cp "$store_test_cp" org.junit.runner.JUnitCore org.openintegrationengine.plugins.communitystore.InstallServiceChecks
java -Djava.awt.headless=true -cp "$store_test_cp" org.openintegrationengine.plugins.communitystore.ui.DocsMarkdownTest
