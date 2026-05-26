package dev.tremors.hubagent.launchers

import android.content.Context
import dev.tremors.hubagent.model.PlayCommand

interface BaseLauncher {
    val appId: String
    fun canHandle(cmd: PlayCommand): Boolean
    fun launch(ctx: Context, cmd: PlayCommand): LaunchResult
}

sealed class LaunchResult {
    object Success : LaunchResult()
    data class Error(val reason: String) : LaunchResult()
    data class AppNotInstalled(val pkg: String) : LaunchResult()
}
