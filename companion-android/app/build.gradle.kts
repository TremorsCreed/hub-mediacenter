plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.tremors.hubcompanion"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.tremors.hubcompanion"
        minSdk = 22
        targetSdk = 34
        versionCode = 2
        versionName = "0.1.1"
    }

    // Cle de debug FIXE (commitee) : signature stable sur tous les builds CI,
    // donc install -r suffit lors des mises a jour (pas de desinstall/reinstall).
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
