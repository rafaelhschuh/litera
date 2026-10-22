package io.github.rafaelhschuh.litera.reader

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream
import org.junit.Assert.*
import org.junit.Test

class SafeEpubTest {
    @Test fun stripsPublicationScriptsAndPrivilegedLinksWhileKeepingTextAndLocalImages() {
        val html = """<html xmlns="http://www.w3.org/1999/xhtml"><head><script src="bad.js" /></head><body onload="steal()"><p>Readable text</p><img src="images/cover.png"/><a href="intent:steal">link</a><iframe src="https://evil.test" /></body></html>"""
        val safe = SafeEpub.sanitize(html.toByteArray()).toString(Charsets.UTF_8)
        assertTrue(safe.contains("Readable text")); assertTrue(safe.contains("images/cover.png"))
        assertFalse(safe.contains("onload=")); assertFalse(safe.contains("bad.js")); assertFalse(safe.contains("<iframe")); assertFalse(safe.contains("intent:steal"))
        assertTrue(safe.contains("Content-Security-Policy")); assertTrue(safe.contains("connect-src 'none'"))
    }
    @Test fun preparesPrivateCopyWithoutChangingAuthorizedArchive() {
        val folder = kotlin.io.path.createTempDirectory("litera-safe-epub").toFile()
        try {
            val source = File(folder,"source.epub")
            ZipOutputStream(source.outputStream()).use { out ->
                out.putNextEntry(ZipEntry("OEBPS/chapter.xhtml")); out.write("<html><head/><body><p>Book</p><script>evil()</script></body></html>".toByteArray()); out.closeEntry()
                out.putNextEntry(ZipEntry("readium/scripts/readium-reflowable.js")); out.write("steal()".toByteArray()); out.closeEntry()
            }
            val original = source.readBytes()
            val safe = SafeEpub.prepare(source,File(folder,"safe.epub"))
            assertArrayEquals(original,source.readBytes())
            ZipFile(safe).use { zip ->
                assertFalse(zip.getInputStream(zip.getEntry("OEBPS/chapter.xhtml")).reader().readText().contains("evil()"))
                assertEquals(0,zip.getInputStream(zip.getEntry("readium/scripts/readium-reflowable.js")).readBytes().size)
            }
            assertFalse(File(folder,"safe.epub.partial").exists())
        } finally { folder.deleteRecursively() }
    }
    @Test fun sanitizesExtensionlessManifestDocumentsAndNamespacedScripts() {
        val folder = kotlin.io.path.createTempDirectory("litera-media-epub").toFile()
        try {
            val source = File(folder,"source.epub")
            ZipOutputStream(source.outputStream()).use { out ->
                val entries = mapOf(
                    "META-INF/container.xml" to """<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>""",
                    "OPS/package.opf" to """<package><manifest><item href="chapter" media-type="application/xhtml+xml"/></manifest></package>""",
                    "OPS/chapter" to """<html><head/><body><svg:script xmlns:svg="http://www.w3.org/2000/svg">steal()</svg:script><p>Book</p></body></html>""",
                )
                entries.forEach { (name,text) -> out.putNextEntry(ZipEntry(name)); out.write(text.toByteArray()); out.closeEntry() }
            }
            val safe = SafeEpub.prepare(source,File(folder,"safe.epub"))
            ZipFile(safe).use { zip ->
                val html = zip.getInputStream(zip.getEntry("OPS/chapter")).reader().readText()
                assertFalse(html.contains("steal()"))
                assertTrue(html.contains("https://*/readium/scripts/readium-reflowable.js"))
                assertTrue(html.contains("script-src-attr 'none'"))
                assertTrue(html.contains("Book"))
            }
        } finally { folder.deleteRecursively() }
    }

    @Test fun rejectsTraversalWithoutExtractingOrPublishingPartialArchive() {
        val folder = kotlin.io.path.createTempDirectory("litera-path-epub").toFile()
        try {
            val source = File(folder,"source.epub"); val target = File(folder,"safe.epub")
            ZipOutputStream(source.outputStream()).use { out -> out.putNextEntry(ZipEntry("../outside.xhtml")); out.write(byteArrayOf(1)); out.closeEntry() }
            assertThrows(IllegalArgumentException::class.java) { SafeEpub.prepare(source,target) }
            assertFalse(target.exists()); assertFalse(File(folder,"safe.epub.partial").exists())
        } finally { folder.deleteRecursively() }
    }
}
