
#include <Servo.h>

Servo servo_5;
Servo servo_6;
Servo servo_7;

// 初始充气5秒
const unsigned long PRE_FILL = 5000;

// 每波海浪抽气2秒
const unsigned long WAVE_OUT = 2000;

// 每波海浪回充2.5秒
const unsigned long WAVE_IN = 2500;

// 最后持续抽气5秒
const unsigned long FINAL_DEFLATE = 5000;

// 充气
void inflate(unsigned long ms) {
    servo_5.write(180);
    servo_6.write(180);
    servo_7.write(0);
    delay(ms);
}

// 抽气
void deflate(unsigned long ms) {
    servo_5.write(0);
    servo_6.write(0);
    servo_7.write(180);
    delay(ms);
}

void setup() {
    Serial.begin(9600);

    servo_5.attach(5);
    servo_6.attach(6);
    servo_7.attach(7);
}

void loop() {

    // ① 初始充气5秒
    Serial.println("INITIAL FILL");
    inflate(PRE_FILL);

    // ② 开始播放海浪音效
    Serial.println("PLAY WAVE AUDIO NOW");

    // ③ 第一波海浪
    deflate(WAVE_OUT);
    inflate(WAVE_IN);

    // 第二波海浪
    deflate(WAVE_OUT);
    inflate(WAVE_IN);

    // 第三波海浪
    deflate(WAVE_OUT);
    inflate(WAVE_IN);

    // ④ 最后1.5秒的过渡
    deflate(1000);
    inflate(500);

    // ⑤ 音效第15秒开始
    // 连续抽气5秒
    Serial.println("FINAL SHRINK");
    deflate(FINAL_DEFLATE);

    // ⑥ 自动重复
    Serial.println("NEXT WAVE CYCLE");
}
