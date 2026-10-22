package io.github.rafaelhschuh.litera.reader

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.parser.Parser

/** Security transform only: publication parsing, layout and navigation belong to Readium.
 * Never extract untrusted paths, overwrite the authorized original, or let book JS run.
 */
object SafeEpub {
    private const val MAX_ENTRY = 32 * 1024 * 1024
    private const val MAX_TOTAL = 512L * 1024 * 1024
    // Readium 3.2 serves reserved hosts readium_package/readium_assets. CSP
    // rejects underscore host-sources. Valid wildcard host sources restrict JS
    // to the two engine paths; matching publisher files are neutralized below.
    // Publisher scripts are removed below; the engine's HttpClient rejects
    // ALL network resources. These sources permit the synthetic engine only
    // in combination with those two enforced boundaries (see security.md).
    private const val CSP = "default-src 'self' data: blob:; script-src https://*/readium/scripts/readium-reflowable.js https://*/readium/scripts/readium-fixed.js; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob:; font-src 'self' data: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"

    fun prepare(source: File, destination: File): File {
        val pending = File(destination.parentFile, destination.name + ".partial")
        destination.parentFile?.mkdirs()
        try {
            ZipFile(source).use { zip ->
                val documents = declaredDocuments(zip)
                ZipOutputStream(pending.outputStream().buffered()).use { output ->
                    var total = 0L
                    var count = 0
                    val names = HashSet<String>()
                    val entries = zip.entries()
                    while (entries.hasMoreElements()) {
                        val entry = entries.nextElement()
                        require(++count <= 10_000) { "Publicação com entradas demais" }
                        require(entry.name.length <= 1024 && !entry.name.startsWith('/') && !entry.name.contains('\\') && entry.name.split('/').none { it == ".." } && names.add(entry.name)) { "Caminho inválido na publicação" }
                        if (entry.isDirectory) continue
                        val bytes = zip.getInputStream(entry).use { input ->
                            val collected = java.io.ByteArrayOutputStream()
                            val buffer = ByteArray(8192)
                            while (true) {
                                val read = input.read(buffer)
                                if (read < 0) break
                                require(collected.size() + read <= MAX_ENTRY) { "Recurso EPUB grande demais" }
                                collected.write(buffer, 0, read)
                            }
                            val bytes = collected.toByteArray()
                            require(bytes.size <= MAX_ENTRY) { "Recurso EPUB grande demais" }
                            total += bytes.size
                            require(total <= MAX_TOTAL) { "Publicação descompactada grande demais" }
                            bytes
                        }
                        val safe = if (entry.name.substringAfterLast('.').lowercase() in setOf("js","mjs")) {
                            ByteArray(0)
                        } else if (entry.name in documents || entry.name.substringAfterLast('.').lowercase() in setOf("html", "htm", "xhtml", "svg")) {
                            sanitize(bytes)
                        } else bytes
                        val target = ZipEntry(entry.name)
                        if(entry.name == "mimetype") {
                            target.method = ZipEntry.STORED; target.size = safe.size.toLong(); target.compressedSize = target.size
                            target.crc = java.util.zip.CRC32().apply { update(safe) }.value
                        }
                        output.putNextEntry(target)
                        output.write(safe)
                        output.closeEntry()
                    }
                }
            }
            check(pending.renameTo(destination)) { "Não foi possível preparar publicação" }
            return destination
        } finally { pending.delete() }
    }

    private fun java.io.InputStream.readBounded(): ByteArray {
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while(true) {
            val count = read(buffer)
            if(count < 0) break
            require(output.size().toLong() + count <= MAX_ENTRY) { "Recurso EPUB grande demais" }
            output.write(buffer,0,count)
        }
        return output.toByteArray()
    }

    /** Media types, rather than filename suffixes alone, define executable EPUB documents. */
    private fun declaredDocuments(zip: ZipFile): Set<String> {
        fun xml(name: String): org.jsoup.nodes.Document? {
            val entry = zip.getEntry(name) ?: return null
            val bytes = zip.getInputStream(entry).use { it.readBounded() }
            require(bytes.size <= MAX_ENTRY) { "Manifesto EPUB grande demais" }
            return Jsoup.parse(bytes.inputStream(),null,"",Parser.xmlParser())
        }
        val documents = mutableSetOf<String>()
        val container = xml("META-INF/container.xml") ?: return documents
        container.select("rootfile").forEach { root ->
            val path = root.attr("full-path")
            require(!path.startsWith('/') && path.split('/').none { it == ".." }) { "Manifesto EPUB inválido" }
            xml(path)?.select("manifest > item")?.forEach { item ->
                if(item.attr("media-type").lowercase() in setOf("application/xhtml+xml","text/html","image/svg+xml")) {
                    val base = java.net.URI(null,null,"/" + path,null)
                    val resolved = base.resolve(item.attr("href")).normalize()
                    if(resolved.scheme == null && resolved.host == null) documents.add(resolved.path.removePrefix("/"))
                }
            }
        }
        return documents
    }

    internal fun sanitize(bytes: ByteArray): ByteArray {
        val doc = Jsoup.parse(bytes.inputStream(), null, "", Parser.xmlParser())
        doc.charset(Charsets.UTF_8)
        doc.outputSettings().syntax(Document.OutputSettings.Syntax.xml).prettyPrint(false)
        val blocked = setOf("script","iframe","frame","frameset","object","embed","applet","foreignobject","base","form")
        doc.getAllElements().toList().filter { it.normalName().substringAfter(':').lowercase() in blocked || (it.normalName().substringAfter(':').equals("meta",true) && it.hasAttr("http-equiv")) }.forEach { it.remove() }
        doc.getAllElements().forEach { element ->
            element.attributes().asList().forEach { attr ->
                val key = attr.key.lowercase()
                val value = attr.value.filterNot { it.isISOControl() }.trim().lowercase()
                if (key.startsWith("on") || key == "srcdoc" || (key in setOf("href", "src", "xlink:href", "action") && (value.startsWith("javascript:") || value.startsWith("file:") || value.startsWith("content:") || value.startsWith("intent:")))) element.removeAttr(attr.key)
            }
        }
        val html = doc.selectFirst("html")
        val head = doc.selectFirst("head") ?: html?.prependElement("head")
        if (head != null) head.prependElement("meta").attr("http-equiv", "Content-Security-Policy").attr("content", CSP)
        return doc.outerHtml().toByteArray(Charsets.UTF_8)
    }
}
