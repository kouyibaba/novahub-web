package com.novahub.app;

import android.app.Activity;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.widget.Toast;
import java.util.Locale;
import java.util.Set;

/** Free on-device Chinese narration. All state is confined to the main thread. */
public final class NovelTtsController {
    public interface Listener {
        void onEvent(String id, String event, String detail);
    }

    private final Activity activity;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final AudioManager audio;
    private TextToSpeech engine;
    private boolean initialized;
    private boolean closed;
    private long engineGeneration;
    private Pending pending;
    private String activeId = "";

    private final AudioManager.OnAudioFocusChangeListener focusListener;

    private static final class Pending {
        final String text;
        final String id;
        final float rate;
        final float pitch;

        Pending(String text, String id, float rate, float pitch) {
            this.text = text;
            this.id = id;
            this.rate = rate;
            this.pitch = pitch;
        }
    }

    public NovelTtsController(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
        this.audio = (AudioManager) activity.getSystemService(Activity.AUDIO_SERVICE);
        this.focusListener = change -> {
            if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                ui.post(() -> {
                    String id = activeId;
                    stop();
                    if (!id.isEmpty()) this.listener.onEvent(id, "error", "audio_focus_lost");
                });
            }
        };
    }

    public void speak(String text, String id, float rate, float pitch) {
        if (closed) return;
        if (text == null || text.trim().isEmpty() || text.length() > 180 || id == null
                || !id.matches("novel-[0-9]+-[0-9]+")) {
            listener.onEvent(id == null ? "" : id, "error", "invalid_speech_request");
            return;
        }
        stop();
        pending = new Pending(text, id, bounded(rate, 0.75f, 1.25f), bounded(pitch, 0.8f, 1.2f));
        try {
            if (engine == null) {
                initialized = false;
                final long generation = ++engineGeneration;
                engine = new TextToSpeech(activity.getApplicationContext(),
                        status -> ui.post(() -> onInitialized(status, generation)));
                ui.postDelayed(() -> {
                    if (!closed && !initialized && generation == engineGeneration && engine != null) {
                        failPending("init_failed");
                        releaseEngine();
                    }
                }, 10000);
            } else if (initialized) {
                speakPending();
            }
        } catch (RuntimeException error) {
            failPending("init_failed");
            releaseEngine();
        }
    }

    private void onInitialized(int status, long generation) {
        if (closed || engine == null || generation != engineGeneration) return;
        if (status != TextToSpeech.SUCCESS) {
            failPending("init_failed");
            releaseEngine();
            return;
        }
        try {
            initialized = true;
            engine.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { finish(id, "done", ""); }
                @Override public void onError(String id) { finish(id, "error", "synthesis_failed"); }
                @Override public void onError(String id, int code) {
                    finish(id, "error", code == TextToSpeech.ERROR_NOT_INSTALLED_YET ? "missing_voice" : "synthesis_failed");
                }
                @Override public void onStop(String id, boolean interrupted) {
                    finish(id, "error", "speech_stopped");
                }
            });
            speakPending();
        } catch (RuntimeException error) {
            failPending("init_failed");
            releaseEngine();
        }
    }

    private boolean selectOfflineChineseVoice() {
        engine.setLanguage(Locale.SIMPLIFIED_CHINESE);
        Set<Voice> voices = engine.getVoices();
        Voice best = null;
        if (voices != null) {
            for (Voice voice : voices) {
                if (!"zh".equals(voice.getLocale().getLanguage()) || voice.isNetworkConnectionRequired()) continue;
                Set<String> features = voice.getFeatures();
                if (features != null && features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                if (best == null || score(voice) > score(best)) best = voice;
            }
        }
        if (best == null) return false;
        return engine.setVoice(best) == TextToSpeech.SUCCESS;
    }

    private static int score(Voice voice) {
        return voice.getQuality() + ("CN".equals(voice.getLocale().getCountry()) ? 1000 : 0);
    }

    @SuppressWarnings("deprecation")
    private void speakPending() {
        if (pending == null || engine == null || !initialized || closed) return;
        Pending next = pending;
        try {
            if (!selectOfflineChineseVoice()) {
                failPending("missing_voice");
                return;
            }
            if (audio != null && audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                failPending("audio_focus_lost");
                return;
            }
            pending = null;
            activeId = next.id;
            engine.setSpeechRate(next.rate);
            engine.setPitch(next.pitch);
            if (engine.speak(next.text, TextToSpeech.QUEUE_FLUSH, new Bundle(), next.id) == TextToSpeech.ERROR) {
                finish(next.id, "error", "synthesis_failed");
            }
        } catch (RuntimeException error) {
            pending = null;
            activeId = next.id;
            finish(next.id, "error", "synthesis_failed");
        }
    }

    private void finish(String id, String event, String detail) {
        ui.post(() -> {
            if (closed || !activeId.equals(id)) return;
            activeId = "";
            abandonFocus();
            listener.onEvent(id, event, detail);
        });
    }

    private void failPending(String detail) {
        if (pending == null) return;
        String id = pending.id;
        pending = null;
        listener.onEvent(id, "error", detail);
    }

    public void stop() {
        pending = null;
        activeId = "";
        if (engine != null) {
            try { engine.stop(); } catch (RuntimeException ignored) { }
        }
        abandonFocus();
    }

    @SuppressWarnings("deprecation")
    private void abandonFocus() {
        if (audio != null) audio.abandonAudioFocus(focusListener);
    }

    public void openSettings() {
        stop();
        releaseEngine();
        try {
            activity.startActivity(new Intent("com.android.settings.TTS_SETTINGS"));
        } catch (RuntimeException error) {
            try {
                activity.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            } catch (RuntimeException ignored) {
                Toast.makeText(activity, "请在系统设置中搜索「文字转语音」并安装离线中文语音", Toast.LENGTH_LONG).show();
            }
        }
    }

    private void releaseEngine() {
        engineGeneration++;
        if (engine != null) {
            try { engine.shutdown(); } catch (RuntimeException ignored) { }
        }
        engine = null;
        initialized = false;
    }

    public void shutdown() {
        closed = true;
        stop();
        releaseEngine();
    }

    private static float bounded(float value, float min, float max) {
        return Float.isNaN(value) || Float.isInfinite(value) ? 1.0f : Math.max(min, Math.min(max, value));
    }
}
