/* Original guest-side networking checks. Optional Linux binaries are
 * built into ignored tests/manual/; no production dependencies are added. */
#include <arpa/inet.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

static int dial(const char *host, const char *port, int type) {
    struct addrinfo hints = {0}, *list = NULL;
    hints.ai_socktype = type;
    if (getaddrinfo(host, port, &hints, &list)) { fprintf(stderr, "DNS lookup failed: %s\n", host); return -1; }
    int fd = -1;
    for (struct addrinfo *item = list; item; item = item->ai_next) {
        fd = socket(item->ai_family, type, 0);
        if (fd < 0) continue;
        struct timeval timeout = {20, 0};
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
        if (!connect(fd, item->ai_addr, item->ai_addrlen)) break;
        close(fd); fd = -1;
    }
    freeaddrinfo(list);
    return fd;
}

static int receive_all(int fd, unsigned char *data, int length) {
    int used = 0;
    while (used < length) {
        int count = recv(fd, data + used, length - used, 0);
        if (count <= 0) return -1;
        used += count;
    }
    return used;
}

int main(int argc, char **argv) {
    if (argc < 3) return 2;
    if (!strcmp(argv[1], "resolve")) {
        struct addrinfo *list = NULL;
        if (getaddrinfo(argv[2], NULL, NULL, &list)) return 3;
        int count = 0;
        for (struct addrinfo *item = list; item; item = item->ai_next) {
            char address[128];
            void *source = item->ai_family == AF_INET ? (void *)&((struct sockaddr_in *)item->ai_addr)->sin_addr : (void *)&((struct sockaddr_in6 *)item->ai_addr)->sin6_addr;
            if (inet_ntop(item->ai_family, source, address, sizeof(address))) { puts(address); count++; }
        }
        freeaddrinfo(list); return count ? 0 : 4;
    }
    int dns = !strncmp(argv[1], "dns-", 4), udp = !strcmp(argv[1], "udp") || !strcmp(argv[1], "dns-udp");
    int fd = dial(argv[2], dns ? "53" : argc > 3 ? argv[3] : "7", udp ? SOCK_DGRAM : SOCK_STREAM);
    if (fd < 0) { perror("connect"); return 5; }
    unsigned char sent[8192], received[8192];
    if (dns) {
        const unsigned char question[] = {0xbe,0xef,1,0,0,1,0,0,0,0,0,0,7,'e','x','a','m','p','l','e',3,'c','o','m',0,0,1,0,1};
        int length;
        if (udp) {
            if (send(fd, question, sizeof(question), 0) != sizeof(question)) return 6;
            length = recv(fd, received, sizeof(received), 0);
        } else {
            unsigned char prefix[] = {0, sizeof(question)};
            if (send(fd, prefix, 2, 0) != 2 || send(fd, question, sizeof(question), 0) != sizeof(question)) return 6;
            if (receive_all(fd, prefix, 2) < 0) return 7;
            length = prefix[0] * 256 + prefix[1];
            if (length > sizeof(received) || receive_all(fd, received, length) < 0) return 7;
        }
        close(fd);
        if (length < 12 || received[0] != 0xbe || received[1] != 0xef || !(received[2] & 128) || (received[3] & 15) || !(received[6] || received[7])) return 8;
        printf("DNS response validated (%d bytes)\n", length); return 0;
    }
    int lengths[] = {1, 37, 4096};
    for (int packet = 0; packet < 3; packet++) {
        int length = lengths[packet];
        for (int i = 0; i < length; i++) sent[i] = (unsigned char)(i * 31 + packet * 17);
        if (send(fd, sent, length, 0) != length) return 9;
        int count = udp ? recv(fd, received, sizeof(received), 0) : receive_all(fd, received, length);
        if (count != length || memcmp(sent, received, length)) return 10;
    }
    close(fd); puts(udp ? "UDP datagrams and fragmentation validated" : "TCP stream integrity validated"); return 0;
}
