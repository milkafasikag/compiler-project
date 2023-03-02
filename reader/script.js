let message = document.querySelector(".five");
function uploadAndReadFile(files) {
    let fr = new FileReader();
    fr.onload = function (e) {
        message.value = e.target.result;
        message.style.color="white";
    };
    console.log(message)
    fr.readAsText(files[0]);
}

let copy=document.querySelector(".copy-btn").addEventListener("click",function(){
    let copText=document.querySelector(".six");
    console.log(copText)
    copText.select();
    document.execCommand('copy');
    window.getSelection().removeAllRanges();
})
const display=document.querySelector(".five")
let save1=document.querySelector(".save").addEventListener("click",function(){
    
    var blob = new Blob([display.value], {
        type: "text/plain;charset=utf-8",
     });
     saveAs(blob, "download.txt");
})

