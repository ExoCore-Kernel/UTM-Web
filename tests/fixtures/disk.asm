; Cold-boot disk persistence probe: sector 2 stores a marker via BIOS int13.
bits 16
org 0x7c00
xor ax,ax
mov ds,ax
mov es,ax
mov ss,ax
mov sp,0x7c00
mov [drive],dl
mov bx,0x8000
mov ax,0x0201
mov cx,2
xor dh,dh
int 0x13
jc failed
cmp byte [0x8000],0x41
je persisted
mov byte [0x8000],0x41
mov ax,0x0301
mov cx,2
mov dl,[drive]
xor dh,dh
int 0x13
jc failed
mov si,written
jmp print
persisted:
mov si,saved
jmp print
failed:
mov si,error
print:
lodsb
test al,al
jz halt
mov dx,0x3f8
out dx,al
jmp print
halt:
cli
hlt
jmp halt
drive: db 0
written: db 'UTM-DISK-WRITTEN-OK',10,0
saved: db 'UTM-DISK-PERSISTED-OK',10,0
error: db 'UTM-DISK-ERROR',10,0
times 510-($-$$) db 0
dw 0xaa55
times 2*1024*1024-($-$$) db 0
