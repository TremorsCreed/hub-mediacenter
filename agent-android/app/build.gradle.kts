plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.tremors.hubagent"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.tremors.hubagent"
        minSdk = 22        // Fire TV Gen 2+, Shield, Android TV 5.1+
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    // Clé de debug FIXE (commitée) : signature stable sur tous les builds CI,
    // donc plus de désinstall/réinstall lors des mises à jour (install -r suffit).
    signingConfigs {
        getByName("debug") {
            storeFile = file("../debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.okhttp)
}
