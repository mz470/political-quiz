
/* =====================================
   1. GitHub 仓库配置
===================================== */

const OWNER = "mz470";
const REPO = "political-quiz";
const BRANCH = "main";
const QUESTION_PATH = "questions";


/* =====================================
   2. 全局数据
===================================== */

let questionBank = {};
let currentQuestions = [];
let currentIndex = 0;

let wrongQuestions = [];
let answered = {};

let mode = "all";


/* =====================================
   3. 获取 GitHub 中的 Word 文件
===================================== */



async function loadQuestionFiles() {

    const url =
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${QUESTION_PATH}?ref=${BRANCH}`;

    const response = await fetch(url);

    if (!response.ok) {
        const error = await response.json();
        throw new Error(
            `GitHub 请求失败：${response.status}，${error.message}`
        );
    }

    const files = await response.json();

    console.log("GitHub 返回的全部文件：", files);

    const wordFiles = files.filter(file => {
        const name = file.name.toLowerCase();

        return file.type === "file" &&
            (name.endsWith(".docx") || name.endsWith(".doc"));
    });

    console.log("筛选出的 Word 文件：", wordFiles);

    if (wordFiles.length === 0) {
        throw new Error(
            "GitHub 已连接，但 questions 文件夹中没有识别到 Word 文件。"
        );
    }

    return wordFiles;
}



/* =====================================
   4. 下载并读取 Word 文档
===================================== */

async function readWord(file) {

    const response = await fetch(file.download_url);

    if (!response.ok) {
        throw new Error("文档下载失败：" + file.name);
    }

    const buffer = await response.arrayBuffer();

    const result = await mammoth.extractRawText({
        arrayBuffer: buffer
    });

    return result.value;
}


/* =====================================
   5. 识别题目编号
===================================== */

function isQuestionStart(line) {

    return /^\s*\d+\s*[、.．]\s*\S/.test(line);
}


function getQuestionNumber(line) {

    const match = line.match(
        /^\s*(\d+)\s*[、.．]/
    );

    return match ? match[1] : null;
}


/* =====================================
   6. 识别选项
===================================== */

function parseOption(line) {

    const match = line.match(
        /^\s*([A-F])\s*[.、．:：)]\s*(.+)$/
    );

    if (!match) return null;

    return {
        letter: match[1],
        content: match[2].trim()
    };
}


/* =====================================
   7. 识别题型
===================================== */

function identifyType(answer, sectionType) {

    if (sectionType) {
        return sectionType;
    }

    if (
        /^(是|否|正确|错误|对|错|Y|N|√|×)$/i.test(answer)
    ) {
        return "判断题";
    }

    if (/^[A-F]{2,}$/i.test(answer)) {
        return "多选题";
    }

    return "单选题";
}


/* =====================================
   8. 标准化答案
===================================== */

function normalizeAnswer(answer) {

    const value = String(answer)
        .toUpperCase()
        .replace(/[\s,，、;；。]/g, "");

    if (/^(是|正确|对|Y|√)$/.test(value)) {
        return "Y";
    }

    if (/^(否|错误|错|N|×)$/.test(value)) {
        return "N";
    }

    return [...value].sort().join("");
}


/* =====================================
   9. 解析 Word 文档
===================================== */

function parseDocument(text, fileName) {

    const lines = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);

    const questions = [];

    let current = null;
    let sectionType = "";

    for (const line of lines) {

        // 识别题型标题

        if (/多项选择题|多项选择|多选题/.test(line)) {

            sectionType = "多选题";
            continue;
        }

        if (/单项选择题|单项选择|单选题/.test(line)) {

            sectionType = "单选题";
            continue;
        }

        if (/判断题/.test(line)) {

            sectionType = "判断题";
            continue;
        }


        // 识别正确答案

        const answerMatch = line.match(
            /【\s*正确答案是\s*】\s*[:：]\s*([A-F]+|是|否|正确|错误|对|错|Y|N|√|×)/i
        );

        if (answerMatch && current) {

            current.answer = answerMatch[1].toUpperCase();

            continue;
        }


        // 识别新题目

        if (isQuestionStart(line)) {

            if (current) {
                questions.push(current);
            }

            current = {

                number: getQuestionNumber(line),

                text: line.replace(
                    /^\d+\s*[、.．]\s*/,
                    ""
                ),

                options: {},

                answer: "",

                sectionType: sectionType
            };

            continue;
        }


        if (!current) continue;


        // 识别选项

        const option = parseOption(line);

        if (option) {

            current.options[option.letter] =
                option.content;

        } else {

            // 题目换行内容

            current.text += "\n" + line;
        }
    }


    // 保存最后一道题

    if (current) {
        questions.push(current);
    }


    // 生成最终题库

    return questions.map(q => {

        const type = identifyType(
            q.answer,
            q.sectionType
        );

        let options = q.options;

        if (type === "判断题") {

            options = {
                Y: "正确",
                N: "错误"
            };
        }

        return {

            number: q.number,

            text: q.text,

            options: options,

            answer: q.answer,

            type: type,

            chapter: fileName.replace(
                /\.docx$/i,
                ""
            )
        };
    });
}


/* =====================================
   10. 加载全部章节
===================================== */

async function loadAllQuestions() {

    const message =
        document.getElementById("message");

    message.textContent = "正在加载 GitHub 题库，请稍候...";

    try {

        const files = await loadQuestionFiles();

        if (files.length === 0) {

            throw new Error(
                "questions 文件夹中没有找到 Word 文档。"
            );
        }

        questionBank = {};

        answered = {};
        wrongQuestions = [];

        for (const file of files) {

            const text = await readWord(file);

            const questions = parseDocument(
                text,
                file.name
            );

            questionBank[file.name] = questions;
        }


        updateChapterList();


        const total = Object.values(questionBank)
            .reduce(
                (sum, list) => sum + list.length,
                0
            );

        document.getElementById(
            "totalCount"
        ).textContent = total;


        message.textContent =
            `题库加载成功，共读取 ${files.length} 个章节，${total} 道题目。`;

        startPractice();

    } catch (error) {

        message.textContent = error.message;

        console.error(error);
    }
}


/* =====================================
   11. 生成章节列表
===================================== */

function updateChapterList() {

    const select =
        document.getElementById("chapterSelect");

    select.innerHTML = "";

    for (const name of Object.keys(questionBank)) {

        const option = document.createElement("option");

        option.value = name;

        option.textContent = name.replace(
            /\.docx$/i,
            ""
        );

        select.appendChild(option);
    }
}


/* =====================================
   12. 开始章节练习
===================================== */

function startPractice() {

    const chapter =
        document.getElementById("chapterSelect").value;

    if (!chapter || !questionBank[chapter]) {
        return;
    }

    mode = "chapter";

    currentQuestions = [
        ...questionBank[chapter]
    ];

    currentIndex = 0;

    renderQuestion();
}


/* =====================================
   13. 渲染题目
===================================== */

function renderQuestion() {

    const area =
        document.getElementById("quizArea");

    if (!currentQuestions.length) {

        area.innerHTML = "<h2>没有可练习的题目</h2>";

        return;
    }

    const q = currentQuestions[currentIndex];

    const key =
        q.chapter + "-" + q.number;

    const selected =
        answered[key]?.selected || [];


    area.innerHTML = "";


    // 题型标签

    const type = document.createElement("span");

    type.className = "question-type";

    type.textContent = q.type;

    area.appendChild(type);


    // 题目内容

    const title = document.createElement("div");

    title.className = "question-title";

    title.textContent =
        `第 ${currentIndex + 1} / ${currentQuestions.length} 题：${q.text}`;

    area.appendChild(title);


    // 选项

    for (const [letter, content] of Object.entries(q.options)) {

        const label = document.createElement("label");

        label.className = "option";


        const input = document.createElement("input");

        input.type =
            q.type === "多选题"
                ? "checkbox"
                : "radio";

        input.name = "answer";

        input.value = letter;

        input.checked =
            selected.includes(letter);


        if (input.checked) {
            label.classList.add("selected");
        }


        input.addEventListener("change", () => {

            if (!answered[key]) {

                answered[key] = {

                    selected: [],

                    submitted: false,

                    isCorrect: false
                };
            }


            if (q.type === "多选题") {

                answered[key].selected = [
                    ...document.querySelectorAll(
                        'input[name="answer"]:checked'
                    )
                ].map(el => el.value);

            } else {

                answered[key].selected = [letter];
            }


            // 重新选择时允许再次提交

            answered[key].submitted = false;

            renderQuestion();
        });


        const span = document.createElement("span");

        span.textContent =
            `${letter}. ${content}`;


        label.appendChild(input);

        label.appendChild(span);

        area.appendChild(label);
    }


    // 显示判题结果

    const result = answered[key];

    if (result?.submitted) {

        showResult(q, result);
    }


    updateStats();

    document.getElementById("message").textContent = "";
}


/* =====================================
   14. 提交答案
===================================== */

function submitAnswer() {

    const q = currentQuestions[currentIndex];

    if (!q) return;


    const key =
        q.chapter + "-" + q.number;


    if (!q.answer) {

        document.getElementById("message").textContent =
            "未识别到正确答案，请检查 Word 文档。";

        return;
    }


    if (
        !answered[key] ||
        !answered[key].selected.length
    ) {

        document.getElementById("message").textContent =
            "请先选择答案。";

        return;
    }


    const correct =
        normalizeAnswer(q.answer);

    const selected =
        normalizeAnswer(
            answered[key].selected.join("")
        );


    answered[key].submitted = true;

    answered[key].isCorrect =
        correct === selected;


    // 错题记录

    if (!answered[key].isCorrect) {

        if (!wrongQuestions.some(item =>
            item.chapter === q.chapter &&
            item.number === q.number
        )) {

            wrongQuestions.push(q);
        }

    } else {

        wrongQuestions = wrongQuestions.filter(item =>
            !(
                item.chapter === q.chapter &&
                item.number === q.number
            )
        );
    }


    renderQuestion();
}


/* =====================================
   15. 显示判题结果
===================================== */

function showResult(q, result) {

    const area =
        document.getElementById("quizArea");

    const div = document.createElement("div");

    div.className = "result";


    const correct =
        normalizeAnswer(q.answer);

    const correctText =
        correct === "Y"
            ? "正确"
            : correct === "N"
                ? "错误"
                : [...correct].join("、");


    const status = document.createElement("p");

    status.className =
        result.isCorrect
            ? "correct"
            : "incorrect";

    status.textContent =
        result.isCorrect
            ? "回答正确 ✓"
            : "回答错误 ✗";


    const yourAnswer = document.createElement("p");

    yourAnswer.textContent =
        "你的答案：" +
        result.selected.join("、");


    const correctAnswer = document.createElement("p");

    correctAnswer.textContent =
        "正确答案：" + correctText;


    div.appendChild(status);

    div.appendChild(yourAnswer);

    div.appendChild(correctAnswer);

    area.appendChild(div);
}


/* =====================================
   16. 更新统计数据
===================================== */

function updateStats() {

    const results =
        Object.values(answered)
            .filter(item => item.submitted);


    const correct =
        results.filter(item => item.isCorrect).length;


    document.getElementById(
        "answeredCount"
    ).textContent = results.length;


    document.getElementById(
        "accuracy"
    ).textContent = results.length
        ? Math.round(
            correct / results.length * 100
        ) + "%"
        : "0%";
}


/* =====================================
   17. 上一题和下一题
===================================== */

function prevQuestion() {

    if (currentIndex > 0) {

        currentIndex--;

        renderQuestion();
    }
}


function nextQuestion() {

    if (
        currentIndex <
        currentQuestions.length - 1
    ) {

        currentIndex++;

        renderQuestion();
    }
}


/* =====================================
   18. 错题练习
===================================== */

function practiceWrong() {

    if (!wrongQuestions.length) {

        document.getElementById("message").textContent =
            "目前没有错题。";

        return;
    }


    mode = "wrong";

    currentQuestions = [
        ...wrongQuestions
    ];

    currentIndex = 0;


    // 清除错题的旧选择，允许重新作答

    for (const q of currentQuestions) {

        const key =
            q.chapter + "-" + q.number;

        answered[key] = {

            selected: [],

            submitted: false,

            isCorrect: false
        };
    }


    renderQuestion();
}


/* =====================================
   19. 全部章节练习
===================================== */

function practiceAll() {

    mode = "all";

    currentQuestions =
        Object.values(questionBank).flat();

    currentIndex = 0;

    renderQuestion();
}


/* =====================================
   20. 绑定按钮
===================================== */

document.getElementById("refreshBtn")
    .addEventListener("click", loadAllQuestions);

document.getElementById("startBtn")
    .addEventListener("click", startPractice);

document.getElementById("submitBtn")
    .addEventListener("click", submitAnswer);

document.getElementById("prevBtn")
    .addEventListener("click", prevQuestion);

document.getElementById("nextBtn")
    .addEventListener("click", nextQuestion);

document.getElementById("wrongBtn")
    .addEventListener("click", practiceWrong);

document.getElementById("allBtn")
    .addEventListener("click", practiceAll);


/* =====================================
   21. 网页启动
===================================== */

loadAllQuestions();
