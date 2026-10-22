import groovy.json.JsonSlurper

plugins {
    id("com.android.application")
}

// The repository package version is authoritative for web, server and Android.
val packageFile = rootProject.layout.projectDirectory.file("../package.json")
val packageJson = JsonSlurper().parseText(providers.fileContents(packageFile).asText.get()) as Map<*, *>
val appVersion = packageJson["version"] as String
val versionParts = Regex("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$")
    .matchEntire(appVersion)?.groupValues?.drop(1)?.map(String::toLong)
    ?: error("package.json version must be a stable major.minor.patch version")
val (major, minor, patch) = versionParts
require(major <= 2099 && minor < 1000 && patch < 1000) {
    "Version exceeds the Android versionCode scheme (major <= 2099, minor/patch < 1000)"
}
val appVersionCode = major * 1_000_000 + minor * 1_000 + patch
require(appVersionCode in 1..2_100_000_000L) { "Android versionCode is out of range" }

android {
    namespace = "io.github.rafaelhschuh.litera"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.rafaelhschuh.litera"
        minSdk = 28
        targetSdk = 36
        versionCode = appVersionCode.toInt()
        versionName = appVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            // Deliberately unsigned. Distribution signing needs its own documented decision.
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
        // Pinned, tested tools are deliberate. New upstream releases must not
        // turn a reproducible build into a failure without any source change.
        disable += setOf("GradleDependency", "AndroidGradlePluginVersion")
        // ADR-0010 pins target 36 for this sideloaded preview. SDKs preinstalled
        // on CI must not silently change its compatibility behavior. Raise the
        // target only with the corresponding device/engine regression gates.
        disable += "OldTargetApi"
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
    implementation("com.google.android.material:material:1.13.0")
    implementation("androidx.activity:activity-ktx:1.12.4")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.webkit:webkit:1.15.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test:core-ktx:1.7.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}
